# Eligibility Agent

SMART on FHIR application for insurance eligibility verification with Claude AI Agent.

## Overview

Practice Fusion Eligibility Agent is a healthcare application that:

1. Launches from Practice Fusion EHR via SMART on FHIR
2. Uses Claude AI Agent to intelligently map messy payer data to correct Stedi payer IDs
3. Verifies insurance eligibility via Stedi X12 270/271
4. Generates summaries with source attribution and discrepancy detection
5. Stores results with HIPAA-compliant audit logging

## Architecture

```
EligibilityAgent/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # Fastify backend + Claude Agent
├── packages/
│   ├── shared/       # Shared types and constants
│   └── db/           # Prisma database schema
└── turbo.json        # Turborepo config
```

## Current Status

### Completed (Phases 1-4)
- **Tenant-centric architecture** - Issuer (FHIR base URL) = Practice = Tenant
- **Session management** - Internal JWTs for API auth, encrypted PF tokens for FHIR
- **Token refresh** - Retry-on-401 pattern with automatic token refresh
- **Redis caching** - Upstash Redis for NPI lookups and SMART config
- **HIPAA audit logging** - Fire-and-forget audit trail for all PHI access
- **Agent output storage** - Final results persisted to PostgreSQL
- **Deployment** - Fly.io with auto-deploy via GitHub Actions

### Pending (Phases 5-7)
- Automated testing (Jest + Playwright E2E)
- Code quality improvements (ESLint strict mode, type safety)
- Monitoring & alerting (Grafana, Fly.io metrics)

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL database
- Upstash Redis account

### Installation

```bash
# Install pnpm if needed
npm install -g pnpm

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Generate Prisma client
pnpm db:generate

# Push database schema
pnpm db:push
```

### Development

```bash
# Start all apps in development mode
pnpm dev

# Or start individual apps
pnpm dev:web   # Frontend at http://localhost:3000
pnpm dev:api   # API at http://localhost:3001

# Run tests
pnpm test
```

### Build

```bash
pnpm build
```

## Environment Variables

See `.env.example` for all required variables:

### Required
- `ANTHROPIC_API_KEY` - Claude API key
- `STEDI_API_KEY` - Stedi eligibility API key
- `PF_CLIENT_ID` - Practice Fusion OAuth client ID
- `PF_CLIENT_SECRET` - Practice Fusion OAuth client secret
- `PF_SCOPES` - OAuth scopes (use `launch` not `launch/patient`)
- `DATABASE_URL` - PostgreSQL connection string
- `ENCRYPTION_KEY` - Token encryption key (`openssl rand -base64 32`)
- `JWT_SECRET` - Internal JWT signing key (`openssl rand -base64 64`)
- `UPSTASH_REDIS_URL` - Upstash Redis REST URL
- `UPSTASH_REDIS_TOKEN` - Upstash Redis token
- `NEXT_PUBLIC_APP_URL` - Frontend URL
- `NEXT_PUBLIC_API_URL` - Backend URL (for SSE)

## Authentication Architecture

```
Browser                    Our API                     Practice Fusion
   │                          │                              │
   │── Cookie (internal JWT)─▶│                              │
   │                          │── Decrypt PF token from DB ─▶│
   │                          │◀── FHIR data ────────────────│
   │◀── Response ─────────────│                              │
```

- **Internal JWT** - Short-lived (15 min), stored in HttpOnly cookie
- **PF OAuth tokens** - Encrypted in PostgreSQL, auto-refreshed on 401
- **Session** - Links JWT to tenant, user, and encrypted tokens

## Agent Workflow

The Claude Agent orchestrates eligibility checks:

1. Validates provider NPI via NPPES registry
2. Maps Practice Fusion payer name to Stedi payer ID
3. Submits X12 270 eligibility request to Stedi
4. Parses X12 271 response and detects discrepancies
5. Generates summary with source attribution

### Stop Conditions

- Max 20 turns per session
- Max 10 Stedi API calls per session
- 2-minute timeout

## Deployment

Deployed to Fly.io with automatic CI/CD:

| Component | URL |
|-----------|-----|
| Web | https://eligibility.practicefusionpm.com |
| API | https://api.eligibility.practicefusionpm.com |

```bash
# View logs
fly logs -a eligibility-api

# Database console
fly postgres connect -a eligibility-db
```

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Backend**: Fastify 5, Node.js
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Upstash Redis
- **AI**: Claude Sonnet (Anthropic API)
- **Build**: Turborepo, pnpm workspaces
- **Deploy**: Fly.io, GitHub Actions

## Documentation

- `SPECIFICATION.md` - Technical specification
- `CLAUDE.md` - Claude Code guidance
- `ROADMAP.md` - Feature roadmap
- `CODE_AUDIT.md` - Security and quality audit

## License

MIT
