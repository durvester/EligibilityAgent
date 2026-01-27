# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `SPECIFICATION.md` for detailed technical documentation.
See `.claude/rules/project-rules.md` for mandatory coding rules.

---

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start both apps (web :3000, api :3001)
pnpm dev:web          # Frontend only
pnpm dev:api          # Backend only
pnpm build            # Build all packages
pnpm test             # Run tests
pnpm lint             # Run ESLint
pnpm format           # Format with Prettier
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema to database
pnpm db:studio        # Open Prisma Studio

# Run a single test file
pnpm --filter @eligibility-agent/api test -- apps/api/src/__tests__/routes/fhir-retry.test.ts

# Run tests matching a pattern
pnpm --filter @eligibility-agent/api test -- --testNamePattern="refresh"
```

---

## Project Structure

```
apps/web/             # Next.js 14 frontend
apps/api/             # Fastify 5 backend + Claude Agent
packages/shared/      # TypeScript types and constants
packages/db/          # Prisma schema and client
fly.api.toml          # Fly.io API config
fly.web.toml          # Fly.io Web config
```

---

## Architecture Overview

### SMART on FHIR Flow
1. EHR launches app with `iss` (FHIR base URL) and `launch` token
2. Backend discovers OAuth endpoints from `{iss}/.well-known/smart-configuration`
3. User authorizes, callback exchanges code for token
4. Backend creates tenant (issuer = tenant identifier) and session
5. Internal JWT stored in HttpOnly cookie, PF tokens encrypted in database
6. Token refresh happens on-demand via retry-on-401 pattern

### Agent Flow
1. Frontend submits patient/insurance/provider data to `/api/agent/eligibility`
2. Agent validates NPI via NPPES (Redis cached)
3. Agent determines Stedi payer ID (from memory, search, or discovery)
4. **Critical**: If using discovery, agent MUST then call `check_eligibility`
5. Agent submits eligibility check to Stedi
6. Agent generates structured JSON output: summary, discrepancies, eligibility data, raw response
7. Results streamed back via SSE

---

## Key Design Decisions

### Practice Fusion FHIR Specifics

**MemberID Location** (CRITICAL):
```
Coverage.extension[url="...#coverage-insured-unique-id"].valueString
```
NOT `Coverage.subscriberId` (contains garbage `\S\0\S\AT`)

**OAuth Scopes**: Use `launch`, NOT `launch/patient`

### Two-Token Authentication
- **Internal JWT**: Short-lived (15 min), HttpOnly cookie, for API auth
- **PF OAuth Tokens**: Encrypted in PostgreSQL, ONLY for FHIR calls

### SSE Streaming
- Agent endpoint uses `@fastify/sse` plugin
- Don't `JSON.stringify()` when using plugin - it handles serialization
- Tool calls streamed as `tool_start`/`tool_end` events

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/api/src/routes/auth.ts` | SMART OAuth with dynamic discovery |
| `apps/api/src/routes/agent.ts` | SSE endpoint for eligibility agent |
| `apps/api/src/routes/fhir.ts` | FHIR proxy with retry-on-401 |
| `apps/api/src/middleware/session.ts` | JWT validation and session attachment |
| `apps/api/src/services/session-service.ts` | Session management, JWT issuance |
| `apps/api/src/services/agent/loop.ts` | Agent loop using Anthropic SDK |
| `apps/api/src/services/agent/tools.ts` | Tool definitions (JSON schema) |
| `apps/api/src/services/agent/executor.ts` | Tool execution dispatch |
| `apps/api/src/services/stedi.ts` | Stedi X12 270/271 client |
| `apps/api/src/lib/encryption.ts` | AES-256-GCM token encryption |
| `apps/api/src/lib/cache.ts` | Upstash Redis caching |
| `apps/web/src/app/eligibility/page.tsx` | Main eligibility UI with SSE client |
| `apps/web/src/lib/sse-client.ts` | SSE parser for fetch-based streams |
| `packages/shared/src/types/index.ts` | All TypeScript types |
| `packages/db/prisma/schema.prisma` | Database schema |

---

## Adding Features

### New Agent Tool
1. Add tool definition in `apps/api/src/services/agent/loop.ts` (in `createEligibilityTools()`)
2. Add case in `executeTool` switch in `apps/api/src/services/agent/executor.ts`
3. Create service function if needed
4. Add tool name to `ToolName` type in `apps/api/src/services/agent/tools.ts`

### New API Route
1. Create file in `apps/api/src/routes/`
2. Register in `apps/api/src/index.ts`
3. Add session middleware for protected routes

### New Shared Type
1. Add to `packages/shared/src/types/index.ts`
2. Re-export from `packages/shared/src/index.ts`

---

## API Patterns

### Response Format
```typescript
// Success
{ success: true, data: {...} }

// Error
{ success: false, error: { code: 'ERROR_CODE', message: '...' } }
```

### SSE Events (Agent)
```
data: {"type":"start"}
data: {"type":"thinking","thinking":"..."}
data: {"type":"tool_start","tool":"lookup_npi","input":{...}}
data: {"type":"tool_end","tool":"lookup_npi","result":{...}}
data: {"type":"complete","eligibilityResult":{...},"summary":"...","discrepancies":{...},"rawResponse":{...}}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API |
| `STEDI_API_KEY` | Yes | Stedi eligibility |
| `PF_CLIENT_ID` | Yes | Practice Fusion OAuth |
| `PF_CLIENT_SECRET` | Yes | Practice Fusion OAuth |
| `PF_SCOPES` | Yes | OAuth scopes (use `launch` not `launch/patient`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | Token encryption (`openssl rand -base64 32`) |
| `JWT_SECRET` | Yes | JWT signing (`openssl rand -base64 64`) |
| `UPSTASH_REDIS_URL` | Yes | Upstash Redis REST URL |
| `UPSTASH_REDIS_TOKEN` | Yes | Upstash Redis token |
| `NEXT_PUBLIC_APP_URL` | Yes | Frontend URL |
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL for SSE |

---

## Deployment

Deployed to Fly.io with auto-deploy via GitHub Actions on push to `main`.

```bash
# View logs
fly logs -a eligibility-api
fly logs -a eligibility-web

# Database console
fly postgres connect -a eligibility-db

# Manual deploy
flyctl deploy --config fly.api.toml --remote-only
```

---

## PR Checklist

1. `pnpm build` passes
2. `pnpm test` passes
3. No new `console.log` statements (use `fastify.log`)
4. No PHI in logs
5. Add tests for new functionality
6. Database queries filter by `tenantId` from session
