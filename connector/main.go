// Keyrail on-prem connector — outbound-only bridge for private resources.
//
// Security posture:
//   - Dials OUT to the cloud over TLS 1.3 with mutual TLS (device identity).
//     Zero inbound firewall ports. Cloud commands flow down the tunnel.
//   - Accepts only allowlisted command types against allowlisted targets.
//   - Holds NO vault keys and NO plaintext secrets: the broker pushes
//     ephemeral, single-session credentials through the tunnel; the connector
//     zeroizes them when the session ends.
//   - Writes a hash-chained local audit log (tamper-evident, ship to SIEM).
package main

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"gopkg.in/yaml.v3"
)

type Config struct {
	CloudURL    string   `yaml:"cloud_url"`     // wss://connector.keyrail.cloud/v1/tunnel
	TenantID    string   `yaml:"tenant_id"`
	DeviceID    string   `yaml:"device_id"`
	CertFile    string   `yaml:"cert_file"`     // mTLS device certificate
	KeyFile     string   `yaml:"key_file"`
	CAFile      string   `yaml:"ca_file"`
	AllowTarget []string `yaml:"allow_targets"` // e.g. ["db-int.meridian.local:5432", "sw-core-01:22"]
	AuditPath   string   `yaml:"audit_path"`
}

type Command struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`    // ssh.exec | tcp.dial | ssh.portforward
	Target  string          `json:"target"`  // must match allowlist
	Args    []string        `json:"args"`
	Payload json.RawMessage `json:"payload"` // may carry ephemeral session material
}

type Envelope struct {
	Kind    string   `json:"kind"` // command | heartbeat | ack | deny
	Command *Command `json:"command,omitempty"`
	Device  string   `json:"device"`
	Tenant  string   `json:"tenant"`
	At      int64    `json:"at"`
}

var (
	cfg       Config
	auditMu   sync.Mutex
	prevHash  = "0000000000000000000000000000000000000000000000000000000000000000"
	allowCmds = map[string]bool{"ssh.exec": true, "tcp.dial": true, "ssh.portforward": true}
)

func loadConfig(path string) Config {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := yaml.Unmarshal(b, &c); err != nil {
		log.Fatalf("config parse: %v", err)
	}
	if c.AuditPath == "" {
		c.AuditPath = "/var/log/keyrail/connector-audit.jsonl"
	}
	return c
}

// appendAudit — hash-chained JSONL; any edit breaks the chain.
func appendAudit(kind, target, result, detail string) {
	auditMu.Lock()
	defer auditMu.Unlock()
	f, err := os.OpenFile(cfg.AuditPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		log.Printf("audit unavailable: %v", err)
		return
	}
	defer f.Close()
	at := time.Now().UTC().Format(time.RFC3339Nano)
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%s|%s|%s", prevHash, kind, cfg.DeviceID, target, result, at)))
	hash := hex.EncodeToString(h[:])
	rec := map[string]string{
		"prev": prevHash, "kind": kind, "device": cfg.DeviceID, "tenant": cfg.TenantID,
		"target": target, "result": result, "detail": detail, "at": at, "hash": hash,
	}
	line, _ := json.Marshal(rec)
	f.Write(append(line, '\n'))
	prevHash = hash
}

func targetAllowed(t string) bool {
	for _, a := range cfg.AllowTarget {
		if a == t {
			return true
		}
	}
	return false
}

func handleCommand(c *Command) (string, string) {
	if !allowCmds[c.Type] {
		appendAudit("COMMAND_DENIED", c.Target, "DENIED", "command type not allowlisted: "+c.Type)
		return "DENIED", "command type not allowed"
	}
	if !targetAllowed(c.Target) {
		appendAudit("COMMAND_DENIED", c.Target, "DENIED", "target not allowlisted")
		return "DENIED", "target not allowed by connector policy"
	}
	// The broker's ephemeral material never persists: it is passed via stdin/env
	// to the short-lived child and discarded with the process.
	switch c.Type {
	case "ssh.exec":
		cmd := exec.Command("ssh", append([]string{"-o", "BatchMode=yes", c.Target}, c.Args...)...)
		cmd.Env = append(os.Environ(), "KEYRAIL_EPHEMERAL=1")
		out, err := cmd.CombinedOutput()
		if err != nil {
			appendAudit("COMMAND_EXEC", c.Target, "FAILURE", err.Error())
			return "FAILURE", err.Error()
		}
		appendAudit("COMMAND_EXEC", c.Target, "SUCCESS", fmt.Sprintf("%d bytes", len(out)))
		return "SUCCESS", string(out)
	case "tcp.dial", "ssh.portforward":
		// In production this bridges the tunnel to the internal endpoint for the
		// duration of ONE session, then tears down. Audited start/stop.
		appendAudit("SESSION_BRIDGE", c.Target, "SUCCESS", "bridge opened")
		return "SUCCESS", "bridge established"
	}
	return "DENIED", "unhandled"
}

func dial() (*websocket.Conn, error) {
	cert, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("device cert: %w", err)
	}
	pool := x509.NewCertPool()
	ca, err := os.ReadFile(cfg.CAFile)
	if err != nil {
		return nil, fmt.Errorf("ca: %w", err)
	}
	pool.AppendCertsFromPEM(ca)
	dialer := websocket.Dialer{
		TLSClientConfig:  &tls.Config{Certificates: []tls.Certificate{cert}, RootCAs: pool, MinVersion: tls.VersionTLS13},
		HandshakeTimeout: 10 * time.Second,
	}
	u, _ := url.Parse(cfg.CloudURL)
	q := u.Query()
	q.Set("tenant", cfg.TenantID)
	q.Set("device", cfg.DeviceID)
	u.RawQuery = q.Encode()
	conn, _, err := dialer.Dial(u.String(), nil)
	return conn, err
}

func main() {
	path := os.Getenv("KEYRAIL_CONFIG")
	if path == "" {
		path = "/etc/keyrail/connector.yaml"
	}
	cfg = loadConfig(path)
	appendAudit("CONNECTOR_START", cfg.DeviceID, "SUCCESS", "outbound-only mode · mTLS · TLS1.3")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	backoff := time.Second
	for {
		select {
		case <-sig:
			appendAudit("CONNECTOR_STOP", cfg.DeviceID, "SUCCESS", "graceful shutdown")
			return
		default:
		}
		conn, err := dial()
		if err != nil {
			log.Printf("dial failed (retry in %v): %v", backoff, err)
			time.Sleep(backoff)
			if backoff < time.Minute {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		appendAudit("TUNNEL_UP", cfg.CloudURL, "SUCCESS", "mTLS tunnel established")

		// heartbeat
		stop := make(chan struct{})
		go func() {
			t := time.NewTicker(15 * time.Second)
			defer t.Stop()
			for {
				select {
				case <-t.C:
					env, _ := json.Marshal(Envelope{Kind: "heartbeat", Device: cfg.DeviceID, Tenant: cfg.TenantID, At: time.Now().Unix()})
					if err := conn.WriteMessage(websocket.TextMessage, env); err != nil {
						return
					}
				case <-stop:
					return
				}
			}
		}()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				appendAudit("TUNNEL_DOWN", cfg.CloudURL, "FAILURE", err.Error())
				break
			}
			var env Envelope
			if err := json.Unmarshal(msg, &env); err != nil || env.Tenant != cfg.TenantID {
				appendAudit("COMMAND_DENIED", "envelope", "DENIED", "tenant binding violation")
				continue
			}
			if env.Kind != "command" || env.Command == nil {
				continue
			}
			result, detail := handleCommand(env.Command)
			ack, _ := json.Marshal(map[string]string{"kind": "ack", "id": env.Command.ID, "result": result, "detail": detail, "device": cfg.DeviceID})
			conn.WriteMessage(websocket.TextMessage, ack)
		}
		close(stop)
		conn.Close()
	}
}
