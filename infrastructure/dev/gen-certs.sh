#!/usr/bin/env bash
# Self-signed PKI for local docker-compose runs.
# DEV ONLY — production uses cert-manager / ACM / Key Vault issued certs.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/certs"
cd "$HERE/certs"

echo "→ local CA"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout ca.key -out ca.crt -subj "/CN=Keyrail Dev CA" 2>/dev/null

echo "→ edge server cert (pam.keyrail.local, localhost)"
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=pam.keyrail.local" 2>/dev/null
printf "subjectAltName=DNS:pam.keyrail.local,DNS:localhost,IP:127.0.0.1\n" > san.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -out server.crt -extfile san.ext 2>/dev/null

echo "→ connector mTLS device cert (conn-sydney-01)"
openssl req -newkey rsa:2048 -nodes -keyout device.key -out device.csr \
  -subj "/CN=conn-sydney-01/O=Keyrail Device" 2>/dev/null
openssl x509 -req -in device.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -out device.crt 2>/dev/null

rm -f server.csr device.csr san.ext
echo "✓ certs ready in $HERE/certs (ca.crt server.crt/key device.crt/key)"
