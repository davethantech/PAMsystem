# Keyrail PAM Cloud - Infrastructure

## Overview

This directory contains the infrastructure configuration for deploying Keyrail PAM Cloud in various environments.

---

## Directory Structure

```
infrastructure/
├── docker-compose.yml          # Base Docker Compose configuration
├── docker-compose.dev.yml      # Development overrides
├── docker-compose.prod.yml     # Production overrides
├── dev/                        # Development-specific files
│   ├── nginx.conf              # Nginx configuration for dev
│   ├── connector.yaml          # Connector configuration for dev
│   ├── gen-certs.sh            # Certificate generation script
│   └── smoke.mjs               # End-to-end smoke test
├── prod/                       # Production-specific files
│   ├── nginx.conf              # Nginx configuration for prod
│   ├── connector.yaml          # Connector configuration for prod
│   └── certs/                  # TLS certificates (not committed)
├── k8s/                        # Kubernetes deployment
│   ├── keyrail.yaml
│   ├── values.yaml
│   └── README.md
└── README.md
```

---

## Local Development

### Prerequisites

- Docker (20.10+)
- Docker Compose (2.0+)
- Node.js (18+)
- OpenSSL

### Quick Start

```bash
# Generate development certificates
bash infrastructure/dev/gen-certs.sh

# Set required environment variable
export COOKIE_SECRET=$(openssl rand -hex 32)

# Start all services
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Seed the database
docker compose exec backend npm run seed:dev

# Run smoke test
node infrastructure/smoke.mjs
```

### Services

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 3000 | React dev server |
| Backend | 8080 | API server |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache |
| Mailpit | 8025 | Email testing |

---

## Production Deployment

### Prerequisites

- Linux server (Ubuntu 22.04+)
- Docker (20.10+)
- Docker Compose (2.0+)
- Domain name with SSL certificate
- Minimum 4GB RAM, 2 vCPUs

### Setup

```bash
# Clone repository
git clone <repository-url>
cd keyrail-pam

# Copy and configure environment
cp .env.production.example .env
nano .env

# Generate COOKIE_SECRET
export COOKIE_SECRET=$(openssl rand -hex 32)
echo "COOKIE_SECRET=$COOKIE_SECRET" >> .env

# Generate TLS certificates
mkdir -p infrastructure/prod/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infrastructure/prod/certs/key.pem \
  -out infrastructure/prod/certs/cert.pem \
  -subj "/CN=pam.yourdomain.com"

# Start services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Run migrations
docker compose exec backend npm run migrate

# Seed initial tenant
docker compose exec backend npm run seed
```

---

## Kubernetes Deployment

For production Kubernetes deployment, see [k8s/](k8s/) directory.

---

## Related Documentation

- [Deployment Guide](../docs/DEPLOYMENT.md)
- [Architecture Overview](../docs/architecture/overview.md)
