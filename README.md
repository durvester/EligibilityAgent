# Eligibility Agent

SMART on FHIR application for insurance eligibility verification with Claude AI Agent.

## Overview

Practice Fusion Eligibility Agent is a healthcare application that:

1. Launches from Practice Fusion EHR via SMART on FHIR
2. Uses Claude AI Agent to intelligently map messy payer data to correct Stedi payer IDs
3. Verifies insurance eligibility via Stedi X12 270/271
4. Generates PDF summaries with source attribution
5. Writes results back to the EHR

## Architecture

```
EligibilityAgent/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # Fastify backend + Claude Agent
├── packages/
│   ├── shared/       # Shared types and constants
│   └── db/           # Prisma database schema
├── evals/            # Agent evaluation suite (TODO)
└── turbo.json        # Turborepo config
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL database

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
```

### Build

```bash
pnpm build
```

## Environment Variables

See `.env.example` for all required variables:

- **Database**: `DATABASE_URL`
- **Practice Fusion**: `PF_FHIR_BASE_URL`, `PF_CLIENT_ID`, `PF_CLIENT_SECRET`
- **Stedi**: `STEDI_API_KEY`, `STEDI_PARTNER_ID`
- **Claude**: `ANTHROPIC_API_KEY`

## SMART on FHIR Flow

1. **Launch**: EHR redirects to `/launch?iss=<fhir-url>&launch=<token>`
2. **Authorize**: App redirects to PF authorization endpoint
3. **Callback**: `/callback` exchanges code for access token
4. **Eligibility**: Main app loads with patient context

## Agent Workflow

The Claude Agent orchestrates eligibility checks:

1. Validates provider NPI via NPPES registry
2. Maps Practice Fusion payer name to Stedi payer ID (core intelligence)
3. Submits X12 270 eligibility request to Stedi
4. Parses X12 271 response
5. Saves successful payer mappings for future use

### Stop Conditions

- Max 10 Stedi API calls per session
- Configurable token limit
- 2-minute timeout

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Backend**: Fastify 5, Node.js
- **Database**: PostgreSQL with Prisma ORM
- **AI**: Claude Sonnet (Anthropic API)
- **Build**: Turborepo, pnpm workspaces

## Design System

- **Colors**: White, Black, Light Blue (#A8D5E5)
- **Style**: Minimalist, Apple/Anthropic inspired
- **Typography**: Inter / SF Pro

## License

MIT
