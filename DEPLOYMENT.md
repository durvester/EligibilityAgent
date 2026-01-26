# Deployment Guide - EligibilityAgent

This guide covers deploying the EligibilityAgent to Fly.io.

## Prerequisites

1. **Fly.io CLI**: Install with `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`
2. **Fly.io Account**: Sign up at [fly.io](https://fly.io)
3. **Environment Variables**: Have your API keys ready:
   - `ANTHROPIC_API_KEY` - Claude API key
   - `STEDI_API_KEY` - Stedi eligibility API key
   - `PF_CLIENT_ID` - Practice Fusion OAuth client ID
   - `PF_CLIENT_SECRET` - Practice Fusion OAuth client secret

## Quick Deploy

Run the automated deployment script:

```bash
./deploy/fly-deploy.sh
```

Or for a custom domain:

```bash
CUSTOM_DOMAIN=eligibility.yourdomain.com ./deploy/fly-deploy.sh
```

## Manual Deployment

### Step 1: Login to Fly.io

```bash
fly auth login
```

### Step 2: Create Apps

```bash
fly apps create eligibility-api --org personal
fly apps create eligibility-web --org personal
```

### Step 3: Create PostgreSQL Database

```bash
fly postgres create \
  --name eligibility-db \
  --region iad \
  --vm-size shared-cpu-1x \
  --initial-cluster-size 1 \
  --volume-size 1

# Attach to API (auto-creates DATABASE_URL secret)
fly postgres attach eligibility-db --app eligibility-api
```

### Step 4: Set API Secrets

```bash
fly secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  STEDI_API_KEY="..." \
  PF_CLIENT_ID="..." \
  PF_CLIENT_SECRET="..." \
  PF_SCOPES="launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read user/Practitioner.read patient/Organization.read" \
  STEDI_API_URL="https://healthcare.us.stedi.com/2024-04-01" \
  ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --app eligibility-api
```

### Step 5: Push Database Schema

```bash
# Get the DATABASE_URL from Fly
fly ssh console --app eligibility-api -C "printenv DATABASE_URL"

# Set locally and push schema
export DATABASE_URL="postgres://..."
pnpm db:push
```

Or via SSH:

```bash
fly ssh console --app eligibility-api
cd /app && npx prisma db push
```

### Step 6: Deploy API

```bash
cd apps/api
fly deploy
```

### Step 7: Deploy Web

```bash
cd apps/web
fly deploy \
  --build-arg NEXT_PUBLIC_APP_URL=https://eligibility-web.fly.dev \
  --build-arg NEXT_PUBLIC_API_URL=https://eligibility-api.fly.dev \
  --build-arg API_URL=https://eligibility-api.fly.dev
```

### Step 8: Verify Deployment

```bash
# Check health
curl https://eligibility-api.fly.dev/health

# Check status
fly status --app eligibility-api
fly status --app eligibility-web
```

## Custom Domain Setup

### Add Certificate

```bash
fly certs create eligibility.yourdomain.com --app eligibility-web
```

### DNS Configuration

Add a CNAME record at your DNS provider:

| Type | Name | Value |
|------|------|-------|
| CNAME | eligibility | eligibility-web.fly.dev |

### Verify SSL

```bash
fly certs show eligibility.yourdomain.com --app eligibility-web
```

Wait for "Ready" status (1-5 minutes after DNS propagation).

### Update Web Build Args

After setting up the custom domain, redeploy web with the correct URL:

```bash
cd apps/web
fly deploy \
  --build-arg NEXT_PUBLIC_APP_URL=https://eligibility.yourdomain.com \
  --build-arg NEXT_PUBLIC_API_URL=https://eligibility-api.fly.dev \
  --build-arg API_URL=https://eligibility-api.fly.dev
```

## Practice Fusion OAuth Callback

Register your callback URL with Practice Fusion:

```
https://eligibility.yourdomain.com/auth/callback
```

Or if using fly.dev subdomain:

```
https://eligibility-web.fly.dev/auth/callback
```

## Monitoring

### View Logs

```bash
fly logs --app eligibility-api
fly logs --app eligibility-web
```

### SSH into Machine

```bash
fly ssh console --app eligibility-api
```

### Database Console

```bash
fly postgres connect -a eligibility-db
```

## Scaling

### Increase Machine Size

```bash
fly scale vm shared-cpu-2x --memory 1024 --app eligibility-api
```

### Add Machines

```bash
fly scale count 2 --app eligibility-api
```

## Troubleshooting

### SSE Streaming Issues

If SSE events are buffered, check the `fly.toml` has proper idle timeout:

```toml
[http_service.http_options]
  idle_timeout = 300
```

### Database Connection Issues

1. Check DATABASE_URL is set: `fly secrets list --app eligibility-api`
2. Verify Prisma client generated: Check build logs for `prisma generate`
3. Verify schema pushed: Connect to DB and check tables exist

### Build Failures

1. Check Dockerfile syntax
2. Verify all files are committed (Docker builds from git context)
3. Check build logs: `fly logs --app <app-name>`

## Cost Estimate

| Resource | Spec | Monthly Cost |
|----------|------|--------------|
| API Machine | shared-cpu-1x, 512MB | ~$5 |
| Web Machine | shared-cpu-1x, 512MB | ~$5 |
| PostgreSQL | shared-cpu-1x, 1GB | ~$7 |
| **Total** | | **~$17/month** |

Machines are billed per second when running. With `auto_stop_machines = false`, they run 24/7.

## Architecture

```
┌─────────────────────────────┐
│   Custom Domain (GoDaddy)   │
│  eligibility.yourdomain.com │
└──────────────┬──────────────┘
               │ CNAME
┌──────────────▼──────────────┐
│   Fly.io Edge (Global CDN)  │
│   Auto SSL + DDoS Protection│
└──────────────┬──────────────┘
               │
  ┌────────────┴────────────────┐
  │                             │
┌─▼───────────┐     ┌──────────▼─────────┐
│eligibility- │     │  eligibility-api   │
│    web      │────▶│    (Fastify)       │
│ (Next.js)   │     │                    │
└─────────────┘     └─────────┬──────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Fly Postgres    │
                    │ (Managed cluster) │
                    └───────────────────┘
```
