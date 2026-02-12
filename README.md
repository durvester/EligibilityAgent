# Eligibility Agent

A SMART on FHIR application for insurance eligibility verification, powered by Claude AI.

## Overview

Eligibility Agent is a healthcare application that:

1. Launches from any FHIR-compliant EHR via SMART on FHIR
2. Uses a Claude AI agent to intelligently map payer data to correct Stedi payer IDs
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

## Features

- **Multi-EHR Support** - Works with multiple EHR vendors (Practice Fusion, Veradigm, extensible to Epic/Cerner)
- **SMART on FHIR Integration** - Launches in EHR context with patient/coverage data
- **AI-Powered Payer Mapping** - Claude agent handles messy payer names and finds correct Stedi IDs
- **Insurance Discovery** - Falls back to demographic-based discovery when payer mapping fails
- **Discrepancy Detection** - Compares EHR data against payer response
- **Source Attribution** - Every data point linked to its source (EHR or payer)
- **Audit Logging** - HIPAA-compliant logging of all PHI access

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL database
- Redis instance (Upstash recommended)

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

# Build
pnpm build
```

## Environment Variables

See `.env.example` for all required variables:

### Core Services
- `ANTHROPIC_API_KEY` - Claude API key from [Anthropic](https://console.anthropic.com/)
- `STEDI_API_KEY` - Stedi eligibility API key from [Stedi](https://www.stedi.com/)

### EHR OAuth (SMART on FHIR) - Multi-EHR Support
Supports multiple EHR vendors with automatic credential selection based on FHIR issuer URL.

**Practice Fusion:**
- `PF_CLIENT_ID` - OAuth client ID
- `PF_CLIENT_SECRET` - OAuth client secret
- `PF_SCOPES` - OAuth scopes (e.g., `launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read`)

**Veradigm/Allscripts:**
- `VERADIGM_CLIENT_ID` - OAuth client ID
- `VERADIGM_CLIENT_SECRET` - OAuth client secret
- `VERADIGM_SCOPES` - OAuth scopes

At least ONE EHR must be configured. Add more EHR systems by following the pattern in `apps/api/src/services/ehr-credentials.ts`.

### Database & Cache
- `DATABASE_URL` - PostgreSQL connection string
- `UPSTASH_REDIS_URL` - Redis REST URL
- `UPSTASH_REDIS_TOKEN` - Redis token

### Security
- `ENCRYPTION_KEY` - Token encryption key (`openssl rand -base64 32`)
- `JWT_SECRET` - Internal JWT signing key (`openssl rand -base64 64`)

### URLs
- `NEXT_PUBLIC_APP_URL` - Frontend URL
- `NEXT_PUBLIC_API_URL` - Backend URL (for SSE)

## Authentication Flow

```
Browser                    API                         EHR FHIR Server
   │                        │                                │
   │── Cookie (JWT) ───────▶│                                │
   │                        │── Decrypt OAuth token ────────▶│
   │                        │◀── FHIR data ──────────────────│
   │◀── Response ───────────│                                │
```

- **Internal JWT** - Short-lived (15 min), stored in HttpOnly cookie
- **EHR OAuth tokens** - Encrypted in PostgreSQL, auto-refreshed on 401
- **Session** - Links JWT to tenant, user, and encrypted tokens

## Agent Workflow

The Claude Agent orchestrates eligibility checks:

1. Validates provider NPI via NPPES registry
2. Maps EHR payer name to Stedi payer ID (search or discovery)
3. Submits X12 270 eligibility request to Stedi
4. Parses X12 271 response and detects discrepancies
5. Generates summary with source attribution

### Stop Conditions

- Max 20 turns per session
- Max 10 Stedi API calls per session
- 2-minute timeout

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Backend**: Fastify 5, Node.js
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis (Upstash)
- **AI**: Claude Sonnet (Anthropic SDK)
- **Build**: Turborepo, pnpm workspaces
- **Deploy**: Fly.io, GitHub Actions

## Deployment

This application can be deployed to Fly.io:

```bash
# Create apps
fly apps create <your-api-app>
fly apps create <your-web-app>

# Create PostgreSQL
fly postgres create --name <your-db-app>
fly postgres attach <your-db-app> --app <your-api-app>

# Set secrets
fly secrets set ANTHROPIC_API_KEY=... --app <your-api-app>
fly secrets set STEDI_API_KEY=... --app <your-api-app>
# ... set all required secrets

# Deploy
flyctl deploy --config fly.api.toml --remote-only
flyctl deploy --config fly.web.toml --remote-only
```

## Related Resources

- [SMART on FHIR](https://docs.smarthealthit.org/) - App launch framework
- [Stedi](https://www.stedi.com/) - X12 EDI APIs
- [Anthropic](https://docs.anthropic.com/) - Claude AI
- [NPPES NPI Registry](https://npiregistry.cms.hhs.gov/) - Provider lookup

## License

MIT
