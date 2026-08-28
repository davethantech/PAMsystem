# Vercel Deployment Guide

This guide provides step-by-step instructions for deploying the Keyrail PAM Cloud platform on Vercel.

## Overview

Vercel is an excellent platform for deploying the Keyrail PAM frontend. However, due to the application's architecture and security requirements, the backend and database must be deployed separately.

### Architecture on Vercel

```
┌─────────────────────────────────────────────────────────────┐
│                        Vercel (Frontend)                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  Static SPA │    │   Next.js    │    │   API Routes     │  │
│  │   (Vite)    │    │   (Future)   │    │  (Proxy to BE)   │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Service (Separate)                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   Fastify   │    │  PostgreSQL  │    │      Redis       │  │
│  │   (Node.js) │    │   (Database) │    │    (Cache)       │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Options

### Option A: Static Site Deployment (Current - Recommended)

Deploy the Vite-built frontend as a static site on Vercel, with the backend hosted on a separate service.

**Pros:**
- Fast deployment
- Simple configuration
- Works with existing Vite setup
- Optimal for static content

**Cons:**
- Backend must be hosted separately
- Requires CORS configuration

### Option B: Next.js Deployment (Future)

Migrate the frontend to Next.js and deploy on Vercel with API routes proxying to the backend.

**Pros:**
- Better Vercel integration
- Server-side rendering capabilities
- API routes for backend proxy
- Built-in optimizations

**Cons:**
- Requires frontend migration
- More complex setup

This guide focuses on **Option A** (Static Site Deployment).

---

## Prerequisites

Before deploying to Vercel, ensure you have:

1. **Vercel Account**: Sign up at [https://vercel.com](https://vercel.com)
2. **Vercel CLI**: Install the CLI globally
   ```bash
   npm install -g vercel
   ```
3. **GitHub Repository**: The Keyrail PAM repository must be connected to Vercel
4. **Backend Service**: A running instance of the Keyrail backend (see [Backend Deployment](#backend-deployment))
5. **Database**: PostgreSQL database (Vercel Postgres or external)
6. **Redis**: Redis instance (Vercel Redis or external)

---

## Step 1: Prepare the Frontend

### Build the Frontend

```bash
# Navigate to the project root
cd /path/to/keyrail-pam

# Install dependencies (if not already installed)
npm install

# Build the frontend for production
npm run build
```

This creates a `dist/` directory with all static files.

### Configure Environment Variables

Create a `.env.local` file in the project root based on `.env.vercel.example`:

```bash
cp .env.vercel.example .env.local
```

Edit `.env.local` with your actual configuration:

```env
# Frontend URL
NEXT_PUBLIC_APP_URL=https://pam.your-domain.com

# Backend API URL
NEXT_PUBLIC_API_URL=https://api.your-domain.com

# WebSocket URL
NEXT_PUBLIC_WS_URL=wss://api.your-domain.com
```

**Important:** The `NEXT_PUBLIC_` prefix makes these variables available to the browser. Never put sensitive secrets (like database passwords) in `NEXT_PUBLIC_` variables.

---

## Step 2: Configure Vercel Project

### Create a New Vercel Project

1. Go to the [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New"** → **"Project"**
3. Select your GitHub repository
4. Click **"Import"**

### Configure Project Settings

#### Basic Settings

| Setting | Value |
|---------|-------|
| Project Name | `keyrail-pam` or your preferred name |
| Framework Preset | **Vite** (or **Other** if Vite is not listed) |
| Root Directory | (leave empty for root) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Development Command | `npm run dev` |

#### Environment Variables

In the Vercel dashboard, go to **Settings** → **Environment Variables** and add the following:

| Name | Value | Type |
|------|-------|------|
| `NEXT_PUBLIC_APP_URL` | `https://pam.your-domain.com` | Public |
| `NEXT_PUBLIC_API_URL` | `https://api.your-domain.com` | Public |
| `NEXT_PUBLIC_WS_URL` | `wss://api.your-domain.com` | Public |

#### Advanced Settings

- **Builds**: Ensure the build command is `npm run build`
- **Output Directory**: Must be `dist`
- **Node.js Version**: Use the latest LTS version (20.x or 22.x)
- **Static Files**: Enable static file serving

---

## Step 3: Configure vercel.json

The project includes a `vercel.json` configuration file that:

1. Configures the static build
2. Sets up routing
3. Configures security headers
4. Handles API proxying

### Customize vercel.json

Edit `vercel.json` to match your domain:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/index.html",
      "status": 200
    }
  ],
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://api.your-domain.com/api/$1"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' https://api.your-domain.com wss://api.your-domain.com; frame-ancestors 'none';"
        }
      ]
    }
  ]
}
```

Replace `https://api.your-domain.com` with your actual backend URL.

---

## Step 4: Configure .vercelignore

The `.vercelignore` file specifies which files and directories should not be deployed to Vercel. The default configuration excludes:

- Node modules
- Build outputs
- Environment files (except examples)
- IDE files
- Git files
- Docker files
- Documentation
- Backend, browser extension, and connector code
- Tests and scripts

This ensures only the frontend static files are deployed.

---

## Step 5: Deploy to Vercel

### Using the Vercel Dashboard

1. Click **"Deploy"** in the Vercel dashboard
2. Vercel will automatically:
   - Clone your repository
   - Install dependencies
   - Run the build command
   - Deploy the static files
3. Wait for the deployment to complete (usually 1-2 minutes)
4. Click the deployment URL to access your application

### Using the Vercel CLI

```bash
# Login to Vercel
vercel login

# Link the project to a Vercel project
vercel link

# Deploy
vercel deploy

# For production deployment
vercel deploy --prod
```

---

## Step 6: Backend Deployment

The Keyrail backend must be deployed separately. Here are the recommended options:

### Option 1: Vercel Serverless Functions (Not Recommended)

**Not recommended** for the Keyrail backend due to:
- Cold starts impact performance
- Execution time limits (10s for free tier, 60s for pro)
- No persistent WebSocket connections
- Limited database connection pooling

### Option 2: Railway.app (Recommended)

[Railway](https://railway.app) is an excellent choice for the backend:

1. Sign up at [https://railway.app](https://railway.app)
2. Create a new project
3. Connect your GitHub repository
4. Configure environment variables (see [Environment Configuration](#environment-configuration))
5. Deploy

**Advantages:**
- Free tier available
- PostgreSQL and Redis add-ons
- Easy scaling
- Good Node.js support

### Option 3: Render.com

[Render](https://render.com) is another good option:

1. Sign up at [https://render.com](https://render.com)
2. Create a new **Web Service**
3. Connect your repository
4. Configure environment variables
5. Deploy

### Option 4: Fly.io

[Fly.io](https://fly.io) is excellent for global deployment:

1. Sign up at [https://fly.io](https://fly.io)
2. Install the CLI: `curl -L https://fly.io/install.sh | sh`
3. Deploy: `fly launch`
4. Configure environment variables

### Option 5: Self-Hosted VPS

Deploy on a VPS using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/your-org/keyrail-pam.git
cd keyrail-pam

# Create .env file
cp .env.production.example .env
# Edit .env with your configuration

# Start the services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Step 7: Environment Configuration

### Backend Environment Variables

The backend requires the following environment variables:

```env
# Database
DATABASE_URL=postgres://user:password@host:5432/database

# Redis
REDIS_URL=redis://user:password@host:6379/0

# Authentication
JWT_SECRET=your-jwt-secret
SESSION_ENCRYPTION_KEY=your-session-key
ARGON2_SECRET=your-argon2-secret

# Encryption (Development)
LOCAL_KMS_MASTER_KEY=your-base64-encoded-32-byte-key

# OIDC Providers (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
ENTRA_CLIENT_ID=your-entra-client-id
ENTRA_CLIENT_SECRET=your-entra-client-secret
ENTRA_TENANT_ID=your-entra-tenant-id

# CORS
CORS_ORIGINS=https://pam.your-domain.com

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000

# Session
SESSION_DURATION_MS=86400000
IDLE_TIMEOUT_MS=1800000

# Launch Grants
LAUNCH_GRANT_LIFETIME_MS=30000

# Logging
LOG_LEVEL=info

# SMTP (Optional)
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@pam.your-domain.com
```

### Generate Secrets

Generate secure secrets using OpenSSL:

```bash
# JWT Secret (32 bytes)
openssl rand -hex 32

# Session Encryption Key (32 bytes)
openssl rand -hex 32

# Argon2 Secret (16 bytes)
openssl rand -hex 16

# Local KMS Master Key (32 bytes, base64 encoded)
openssl rand -base64 32
```

---

## Step 8: Configure CORS

The backend must be configured to accept requests from your Vercel frontend. In the backend `routes.ts` file, ensure CORS is properly configured:

```typescript
// backend/src/routes.ts
import { fastifyCors } from '@fastify/cors';

// Configure CORS
fastify.register(fastifyCors, {
  origin: process.env.CORS_ORIGINS?.split(',') || [],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
});
```

Set `CORS_ORIGINS` to your Vercel frontend URL:

```env
CORS_ORIGINS=https://pam.your-domain.com,https://www.pam.your-domain.com
```

---

## Step 9: Configure Database

### Vercel Postgres

Vercel offers a managed PostgreSQL database:

1. Go to [Vercel Storage](https://vercel.com/dashboard/storage)
2. Create a new **Postgres** database
3. Copy the connection string
4. Set `DATABASE_URL` in your backend environment variables

**Limitations:**
- Free tier has limited storage and bandwidth
- No Row Level Security (RLS) support in free tier
- Consider external PostgreSQL for production

### External PostgreSQL

For production, use a managed PostgreSQL service:

- **Supabase**: [https://supabase.com](https://supabase.com)
- **Neon**: [https://neon.tech](https://neon.tech)
- **AWS RDS**: [https://aws.amazon.com/rds/postgresql/](https://aws.amazon.com/rds/postgresql/)
- **Azure Database for PostgreSQL**: [https://azure.microsoft.com/en-us/products/postgresql/](https://azure.microsoft.com/en-us/products/postgresql/)
- **Google Cloud SQL**: [https://cloud.google.com/sql](https://cloud.google.com/sql)

### Configure RLS

The Keyrail backend uses PostgreSQL Row Level Security (RLS) for tenant isolation. Ensure RLS is enabled on all tenant-scoped tables:

```sql
-- Enable RLS on the database
ALTER DATABASE keyrail SET FORCE_ROW_LEVEL_SECURITY = ON;

-- Create policies for each table
-- Example for users table
CREATE POLICY tenant_isolation_policy ON users
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant'));
```

---

## Step 10: Configure Redis

### Vercel Redis

Vercel offers a managed Redis service:

1. Go to [Vercel Storage](https://vercel.com/dashboard/storage)
2. Create a new **Redis** database
3. Copy the connection URL
4. Set `REDIS_URL` in your backend environment variables

### External Redis

For production, use a managed Redis service:

- **Upstash**: [https://upstash.com](https://upstash.com) (Recommended for Vercel)
- **Redis Labs**: [https://redis.com](https://redis.com)
- **AWS ElastiCache**: [https://aws.amazon.com/elasticache/](https://aws.amazon.com/elasticache/)
- **Azure Cache for Redis**: [https://azure.microsoft.com/en-us/products/cache/](https://azure.microsoft.com/en-us/products/cache/)

---

## Step 11: Configure Custom Domain

### Add a Custom Domain

1. Go to your Vercel project dashboard
2. Click **"Settings"** → **"Domains"**
3. Click **"Add Domain"**
4. Enter your domain (e.g., `pam.your-domain.com`)
5. Follow the DNS configuration instructions

### Configure DNS

Add the following DNS records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | pam | cname.vercel-insight.com | Auto |
| CNAME | api | your-backend-service | Auto |

### SSL Certificate

Vercel automatically provisions and renews SSL certificates for custom domains.

---

## Step 12: Configure Security Headers

The `vercel.json` file includes security headers. Verify and customize them:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {"key": "X-Frame-Options", "value": "DENY"},
        {"key": "X-Content-Type-Options", "value": "nosniff"},
        {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"},
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' https://api.your-domain.com wss://api.your-domain.com; frame-ancestors 'none'; form-action 'self';"
        },
        {"key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload"}
      ]
    }
  ]
}
```

**Important:** Update the `connect-src` directive to include your backend URL.

---

## Step 13: Test the Deployment

### Verify Frontend

1. Access your Vercel deployment URL
2. Verify the login page loads
3. Check the browser console for errors
4. Test navigation between pages

### Verify API Connectivity

1. Open the browser console
2. Check that API requests are being made to the correct backend URL
3. Verify CORS headers are present in responses
4. Test authentication flow

### Verify Security

1. Check that security headers are present in responses
2. Verify that sensitive data is not exposed in the frontend
3. Test that cross-tenant access is prevented
4. Verify that credentials cannot be viewed or exported

---

## Step 14: Set Up Monitoring

### Vercel Analytics

Enable Vercel Analytics in your project settings to monitor:
- Page views
- Performance metrics
- Error tracking

### Backend Monitoring

Configure monitoring for your backend service:

- **Logging**: Ensure logs are captured and stored
- **Metrics**: Monitor request rates, error rates, and response times
- **Alerts**: Set up alerts for errors and performance issues
- **APM**: Use Application Performance Monitoring (e.g., New Relic, Datadog)

### Error Tracking

Use error tracking services:
- **Sentry**: [https://sentry.io](https://sentry.io)
- **Bugsnag**: [https://bugsnag.com](https://bugsnag.com)

---

## Step 15: Set Up CI/CD

### GitHub Actions

Create a `.github/workflows/deploy.yml` file to automate deployments:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main, production]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies
        run: npm install

      - name: Build frontend
        run: npm run build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-args: '--prod'
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

### Vercel Token

1. Go to [Vercel Account Settings](https://vercel.com/account/tokens)
2. Create a new **Access Token**
3. Add the token to GitHub Secrets as `VERCEL_TOKEN`

### Organization and Project IDs

Find these in the Vercel dashboard URL or settings page.

---

## Troubleshooting

### Common Issues

#### 1. Build Fails

**Error:** `Build command failed`

**Solution:**
- Ensure all dependencies are installed: `npm install`
- Check Node.js version compatibility
- Verify the build command in `package.json`

#### 2. Static Files Not Found

**Error:** `404 Not Found` for static assets

**Solution:**
- Verify the `distDir` in `vercel.json` matches your build output directory
- Ensure the build command creates files in the correct directory
- Check that files are not excluded by `.vercelignore`

#### 3. CORS Errors

**Error:** `CORS policy blocked request`

**Solution:**
- Verify `CORS_ORIGINS` in backend environment variables
- Ensure the frontend URL is included in allowed origins
- Check that CORS middleware is configured in the backend

#### 4. Environment Variables Not Available

**Error:** `NEXT_PUBLIC_API_URL is undefined`

**Solution:**
- Ensure variables are prefixed with `NEXT_PUBLIC_` for frontend access
- Verify variables are set in the Vercel dashboard
- Check that variables are not excluded by `.vercelignore`

#### 5. API Requests Fail

**Error:** `Failed to fetch` or `500 Internal Server Error`

**Solution:**
- Verify the backend is running and accessible
- Check that the `NEXT_PUBLIC_API_URL` is correct
- Test API endpoints directly using curl or Postman
- Verify backend logs for errors

### Debugging

#### Frontend Debugging

1. Open browser console (F12)
2. Check for JavaScript errors
3. Inspect network requests
4. Verify environment variables in the frontend

#### Backend Debugging

1. Check backend logs
2. Test API endpoints with curl:
   ```bash
   curl -v https://api.your-domain.com/health
   ```
3. Verify database connectivity
4. Check Redis connectivity

#### Vercel Debugging

1. View deployment logs in the Vercel dashboard
2. Check the "Functions" tab for serverless function logs
3. Use `vercel logs` CLI command
4. Enable verbose logging in `vercel.json`:
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "package.json",
         "use": "@vercel/static-build",
         "config": {
           "distDir": "dist",
           "debug": true
         }
       }
     ]
   }
   ```

---

## Performance Optimization

### Frontend Optimization

1. **Enable Compression**: Vercel automatically compresses static files
2. **Enable Caching**: Configure cache headers in `vercel.json`:
   ```json
   {
     "headers": [
       {
         "source": "/assets/(.*)",
         "headers": [
           {"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}
         ]
       }
     ]
   }
   ```
3. **Lazy Loading**: Implement code splitting in your frontend
4. **Image Optimization**: Use modern image formats (WebP, AVIF)

### Backend Optimization

1. **Connection Pooling**: Configure PostgreSQL connection pooling
2. **Redis Caching**: Cache frequently accessed data
3. **Rate Limiting**: Implement rate limiting to prevent abuse
4. **Compression**: Enable response compression

---

## Security Considerations

### HTTPS

- Vercel automatically provisions HTTPS for all deployments
- Ensure your custom domain has HTTPS enabled
- Never use HTTP in production

### Secrets Management

- **Never** commit secrets to Git
- Use environment variables for all sensitive data
- Rotate secrets regularly
- Use a secrets manager for production (AWS Secrets Manager, HashiCorp Vault)

### Authentication

- Enable MFA for all user accounts
- Use strong password policies
- Implement rate limiting for authentication endpoints
- Monitor failed login attempts

### Data Protection

- All sensitive data must be encrypted at rest
- Use envelope encryption for credentials
- Never log sensitive data
- Implement proper access controls

### Network Security

- Restrict backend access to frontend domains
- Use IP allowlisting if possible
- Implement DDoS protection
- Monitor for suspicious activity

---

## Scaling

### Frontend Scaling

- Vercel automatically scales static sites
- No configuration needed for scaling
- Consider edge caching for global users

### Backend Scaling

- **Railway/Render**: Automatically scales based on traffic
- **Fly.io**: Supports horizontal scaling
- **Self-hosted**: Use load balancers and multiple instances
- **Database**: Use connection pooling and read replicas
- **Redis**: Use clustering for high availability

---

## Cost Optimization

### Vercel Costs

- **Free Tier**: Sufficient for development and small projects
- **Pro Tier**: $20/month for advanced features
- **Enterprise**: Custom pricing for large-scale deployments

### Backend Costs

- **Railway**: Free tier available, pay-as-you-go
- **Render**: Free tier available, pay-as-you-go
- **Fly.io**: Free tier available, pay-as-you-go
- **Database**: Use managed services with free tiers
- **Redis**: Use managed services with free tiers

### Cost Monitoring

- Set up budget alerts in Vercel
- Monitor backend service costs
- Optimize resource usage
- Use auto-scaling to match demand

---

## Migration to Next.js (Future)

For better Vercel integration, consider migrating the frontend to Next.js:

### Benefits

- Server-side rendering
- API routes for backend proxy
- Built-in optimizations
- Better Vercel integration
- Automatic code splitting

### Migration Steps

1. Create a new Next.js project:
   ```bash
   npx create-next-app@latest frontend-next --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
   ```

2. Copy frontend files to the new project

3. Update routing to use Next.js file-based routing

4. Configure API routes to proxy to the backend:
   ```typescript
   // pages/api/[...path].ts
   import { NextApiRequest, NextApiResponse } from 'next';
   
   export default async function handler(
     req: NextApiRequest,
     res: NextApiResponse
   ) {
     const { path } = req.query;
     const backendUrl = process.env.BACKEND_API_URL;
     
     const response = await fetch(`${backendUrl}/${Array.isArray(path) ? path.join('/') : path}`, {
       method: req.method,
       headers: req.headers,
       body: req.body,
     });
     
     const data = await response.json();
     return res.status(response.status).json(data);
   }
   ```

5. Update `vercel.json` for Next.js:
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "frontend-next/package.json",
         "use": "@vercel/next",
         "config": {}
       }
     ],
     "routes": []
   }
   ```

6. Test and deploy

---

## Support

### Vercel Support

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Community](https://vercel.com/community)
- [Vercel Support](https://vercel.com/support)

### Keyrail PAM Support

- [Documentation](../README.md)
- [Architecture Overview](../architecture/overview.md)
- [Security Documentation](../security/invariants.md)
- [GitHub Issues](https://github.com/your-org/keyrail-pam/issues)

---

## Conclusion

Deploying Keyrail PAM on Vercel is a straightforward process:

1. ✅ Prepare the frontend (build and configure)
2. ✅ Create a Vercel project
3. ✅ Configure environment variables
4. ✅ Deploy the frontend
5. ✅ Deploy the backend separately
6. ✅ Configure CORS and security
7. ✅ Set up custom domain and SSL
8. ✅ Test and monitor

For production deployments, consider using managed services for the backend, database, and Redis to ensure reliability, scalability, and security.

---

## Quick Start Checklist

- [ ] Create Vercel account
- [ ] Connect GitHub repository
- [ ] Build frontend (`npm run build`)
- [ ] Configure environment variables
- [ ] Deploy to Vercel
- [ ] Deploy backend (Railway, Render, Fly.io, or VPS)
- [ ] Configure CORS
- [ ] Set up database (Vercel Postgres or external)
- [ ] Set up Redis (Vercel Redis or external)
- [ ] Configure custom domain
- [ ] Test deployment
- [ ] Set up monitoring
- [ ] Configure CI/CD

---

*Last updated: 2024*
