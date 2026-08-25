# Running locally & hosting on Hostinger

## Which Hostinger plan fits which part?

| Plan | What it can run | Verdict |
|---|---|---|
| **Shared** (Premium / Business / Cloud) | Static files only (Apache/LiteSpeed) | ✅ The **console** — build once, upload `dist/` |
| **VPS** (KVM 1+) | Docker, Node, Postgres, Redis | ✅ The **full stack** — backend + vault + connector |

The console is a fully self-contained SPA (no API calls), so shared hosting is
genuinely enough for it. The control plane needs a VPS — shared hosting cannot
run PostgreSQL or long-lived Node processes.

---

## Part A — run it on your local machine

```bash
# 1. console (React + Vite)
npm install
npm run dev            # → http://localhost:5173
npm run build          # → production bundle in dist/

# 2. (optional) the full stack — needs Docker Desktop
bash infrastructure/dev/gen-certs.sh
export COOKIE_SECRET=$(openssl rand -hex 32)
cd infrastructure && docker compose up --build
# new terminal:
docker compose exec backend npm run seed:dev
node infrastructure/smoke.mjs        # 14-step end-to-end gate → http://127.0.0.1:8081
```

---

## Part B — host the console on Hostinger shared hosting

1. **Build**: `npm run build` (subdirectory? use `npm run build -- --base=/pam/`)
2. **hPanel → Files → File Manager → `public_html`**
3. Upload the **contents** of `dist/` — `index.html`, `assets/`, `.htaccess` —
   *not* the `dist` folder itself. (Enable "show hidden files" in the File
   Manager settings so `.htaccess` uploads; it carries the security headers.)
4. Visit your domain. Done — no build step, database, or process ever runs there.

FTP alternative: hPanel → Files → FTP Accounts, then point FileZilla at the
host shown there and copy the same files into `public_html`.

---

## Part C — host the full stack on a Hostinger VPS

1. **VPS plan** (KVM 2+ recommended), OS template **Ubuntu 24.04**.
2. **SSH in** (hPanel → VPS → IP + root password):
   ```bash
   ssh root@YOUR_VPS_IP
   apt update && apt install -y docker.io docker-compose-plugin ufw unzip
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
   ```
3. **Get the code up** — zip the repo locally, then:
   ```bash
   scp keyrail.zip root@YOUR_VPS_IP:/opt/
   ssh root@YOUR_VPS_IP "mkdir -p /opt/keyrail && cd /opt && unzip keyrail.zip -d keyrail"
   ```
4. **Point your domain at it**: hPanel → Advanced → DNS Zone → add an
   `A` record (e.g. `pam.yourdomain.com`) → your VPS IP.
5. **Adjust the hostname** — edit `infrastructure/dev/nginx.conf` and replace
   `server_name pam.keyrail.local;` with your real domain.
6. **Boot & seed**:
   ```bash
   cd /opt/keyrail
   bash infrastructure/dev/gen-certs.sh
   export COOKIE_SECRET=$(openssl rand -hex 32)
   cd infrastructure && docker compose up --build -d
   docker compose exec backend npm run seed
   KEYRAIL_API=http://127.0.0.1:8081 node smoke.mjs   # all 14 steps green?
   ```
7. **Real TLS**: swap the self-signed certs for Let's Encrypt (install
   `certbot` on the host, terminate at nginx, mount the live certs) — the
   self-signed PKI is dev-only.

### Expectations, honestly

- `KMS_PROVIDER=local` on the VPS uses an ephemeral in-memory master key:
  secrets would be unrecoverable after a container rebuild. For anything real,
  switch to a cloud KMS (`KMS_PROVIDER=aws` + key id) and run the key ceremony.
- Hostinger VPS backups exist, but configure them in hPanel — Postgres PITR is
  your job per `docs/DEPLOYMENT.md`.
- The shared-hosting console and the VPS stack are the same product: the
  console ships with the control plane *simulated in-browser* so it runs
  anywhere; wiring it to your live VPS API is the integration step before
  production use.
