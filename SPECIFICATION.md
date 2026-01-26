# Eligibility Agent - Technical Specification

## 1. Project Overview

**Name:** Practice Fusion Eligibility Agent
**Type:** SMART on FHIR Application with AI Agent
**Purpose:** Verify patient insurance eligibility from within Practice Fusion EHR

### 1.1 Problem Statement
Healthcare practices need a frictionless way to verify patient insurance eligibility before appointments. Current manual processes are time-consuming and error-prone. Additionally, Practice Fusion stores payer data inconsistently (e.g., "Aetna", "AETNA PPO", "Aetna Better Health"), making it difficult to map to clearinghouse payer IDs.

### 1.2 Solution
A SMART on FHIR app launched from Practice Fusion EHR that:
1. Authenticates via SMART on FHIR OAuth
2. Fetches patient and coverage data from Practice Fusion FHIR API
3. Uses an autonomous Claude AI agent to determine the correct Stedi payer ID
4. Verifies insurance eligibility via Stedi X12 270/271
5. Displays results with full agent observability
6. (Future) Writes results back to the EHR

---

## 2. Technology Stack

### 2.1 Monorepo Structure
| Choice | Technology | Rationale |
|--------|------------|-----------|
| Package Manager | pnpm | Fast, disk-efficient, strict dependency resolution |
| Build System | Turborepo | Incremental builds, task caching, parallel execution |
| Language | TypeScript | Type safety across frontend/backend, shared types |

### 2.2 Frontend (`apps/web`)
| Choice | Technology | Rationale |
|--------|------------|-----------|
| Framework | Next.js 14 | App Router, React Server Components, easy deployment |
| Styling | Tailwind CSS | Utility-first, consistent design system, small bundle |
| Icons | Lucide React | Lightweight, consistent icon set |
| State | React useState/useEffect | Simple state needs, no complex global state required |

### 2.3 Backend (`apps/api`)
| Choice | Technology | Rationale |
|--------|------------|-----------|
| Framework | Fastify 5 | High performance, TypeScript support, plugin ecosystem |
| HTTP Client | Axios | Mature, interceptors, timeout handling |
| AI Agent | Anthropic SDK | Direct Claude API access, tool use support |
| Streaming | Server-Sent Events (SSE) | Real-time agent updates, simple protocol |

### 2.4 Database (`packages/db`)
| Choice | Technology | Rationale |
|--------|------------|-----------|
| Database | PostgreSQL | ACID compliance, JSON support, Azure managed option |
| ORM | Prisma | Type-safe queries, migrations, schema as code |

### 2.5 Shared (`packages/shared`)
- TypeScript types for FHIR R4 resources
- Domain types (Patient, Insurance, Provider, Eligibility)
- Constants (service type codes, agent limits)

---

## 3. Architecture

### 3.1 High-Level Flow
```
┌─────────────────────────────────────────────────────────────────┐
│                    Practice Fusion EHR                          │
│                    (iframe launch)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /launch?iss=<fhir-url>&launch=<token>                          │
│                                                                 │
│  1. Discover OAuth endpoints from iss                           │
│     GET {iss}/.well-known/smart-configuration                   │
│     (fallback: GET {iss}/metadata)                              │
│                                                                 │
│  2. Redirect to authorization_endpoint                          │
│     with client_id, scopes, launch token                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /callback?code=<auth-code>&state=<state>                       │
│                                                                 │
│  3. Exchange code for token at token_endpoint                   │
│     Returns: access_token, patient ID, fhirBaseUrl              │
│                                                                 │
│  4. Redirect to /eligibility?patient=<id>                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /eligibility                                                   │
│                                                                 │
│  5. Fetch patient data via FHIR API                             │
│     GET {fhirBaseUrl}/Patient/{id}                              │
│     GET {fhirBaseUrl}/Coverage?patient={id}                     │
│                                                                 │
│  6. User fills in missing data (member ID, NPI)                 │
│                                                                 │
│  7. Submit to Agent endpoint (SSE streaming)                    │
│     POST /api/agent/eligibility                                 │
│                                                                 │
│  8. Display results with agent trace                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Agent SDK (claude-sonnet-4-20250514 + extended thinking)│
├─────────────────────────────────────────────────────────────────┤
│  Tools (MCP-style via createSdkMcpServer):                      │
│  ├── lookup_npi        → NPPES Registry API                     │
│  ├── search_npi        → NPPES search by name                   │
│  ├── search_payers     → Stedi payer directory                  │
│  ├── get_payer_mapping → In-memory store (agent's memory)       │
│  ├── save_payer_mapping → In-memory store                       │
│  ├── check_eligibility → Stedi X12 270/271 API                  │
│  └── discover_insurance → Stedi Insurance Discovery (slow)      │
├─────────────────────────────────────────────────────────────────┤
│  Critical Rules:                                                │
│  ├── Discovery → Eligibility: MUST call check_eligibility       │
│  │   after discover_insurance (discovery finds data,            │
│  │   eligibility is the actual goal)                            │
│  └── Structured Output: Agent outputs JSON with summary,        │
│      discrepancies, eligibility data, and raw response          │
├─────────────────────────────────────────────────────────────────┤
│  Stop Conditions:                                               │
│  ├── Max 20 turns (configurable)                                │
│  ├── Max 10 Stedi API calls                                     │
│  ├── Agent completes task                                       │
│  └── Client disconnection                                       │
├─────────────────────────────────────────────────────────────────┤
│  Output: SSE stream via @fastify/sse plugin                     │
│  ├── start, thinking, text, tool_start, tool_end events         │
│  └── complete event with:                                       │
│      ├── eligibilityResult (parsed benefits data)               │
│      ├── summary (markdown with source attribution)             │
│      ├── discrepancies (input vs response mismatches)           │
│      ├── rawResponse (full Stedi X12 271 JSON)                  │
│      └── usage (tokens + cost)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. API Endpoints

### 4.1 Authentication (`/auth`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/launch` | GET | SMART launch - discovers OAuth, redirects to authorize |
| `/auth/callback` | POST | Exchange auth code for token |
| `/auth/refresh` | POST | Refresh access token |

### 4.2 FHIR Proxy (`/fhir`)
| Endpoint | Method | Headers Required | Description |
|----------|--------|------------------|-------------|
| `/fhir/patient/:id` | GET | Authorization, X-FHIR-Base-URL | Get patient + coverage + practitioner |
| `/fhir/:resourceType/:id` | GET | Authorization, X-FHIR-Base-URL | Generic FHIR resource fetch |

### 4.3 NPI (`/npi`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/npi/validate` | GET | Validate NPI format and lookup in NPPES |
| `/npi/search` | GET | Search NPPES by name/state/taxonomy |
| `/npi/:npi` | GET | Get full NPI details |

### 4.4 Agent (`/agent`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/eligibility` | POST | Main eligibility check (SSE streaming) |

### 4.5 Eligibility (`/eligibility`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/eligibility/save` | POST | Save results to EHR (NOT IMPLEMENTED) |
| `/eligibility/history/:patientId` | GET | Get check history (NOT IMPLEMENTED) |

### 4.6 Card Parse (`/card-parse`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/card-parse` | POST | Parse insurance card image with Claude Vision |

---

## 5. Data Models

### 5.1 Database Schema (Prisma)

**Tenant** - Multi-tenant practice configuration
- OAuth credentials (encrypted)
- Stedi API key (encrypted)
- FHIR configuration

**OAuthToken** - Stored tokens per user session
- Access/refresh tokens (encrypted)
- Expiration tracking
- Patient context

**EligibilityCheck** - Historical eligibility checks
- Patient demographics
- Insurance info
- Stedi request/response
- Parsed benefits data

**PayerMapping** - Agent's long-term memory
- Practice Fusion payer name → Stedi payer ID
- Success/failure counts
- Confidence score

**AgentTrace** - Full agent observability
- Each tool call with input/output
- Timing and token usage
- Linked to eligibility check

**AuditLog** - HIPAA compliance
- All PHI access logged
- User, action, resource, timestamp

### 5.2 Key Types (TypeScript)

```typescript
interface PatientInfo {
  fhirId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;  // YYYY-MM-DD
  gender: 'M' | 'F' | 'U';
  address?: { street, city, state, zipCode };
}

interface InsuranceInfo {
  payerName: string;     // From FHIR Coverage.payor[0].display
  memberId: string;      // From extension: coverage-insured-unique-id (NOT subscriberId!)
  groupNumber?: string;  // From Coverage.class[type=group].value
}

interface ProviderInfo {
  npi: string;           // 10 digits, validated
  firstName: string;
  lastName: string;
  credentials?: string;
}

interface EligibilityResponse {
  status: 'active' | 'inactive' | 'unknown';
  planName?: string;
  effectiveDate?: string;
  benefits: BenefitInfo[];
  copay?: CopayInfo[];
  deductible?: DeductibleInfo;
  outOfPocketMax?: OutOfPocketInfo;
  rawResponse?: unknown;  // Full Stedi X12 271 JSON
}

// Agent-detected discrepancies between input and Stedi response
interface Discrepancy {
  field: string;           // e.g., "memberId", "patientName"
  inputValue: string;      // What we sent
  responseValue: string;   // What Stedi returned
  severity: 'warning' | 'error';
  suggestion?: string;     // Agent's suggested correction
}

interface DiscrepancyReport {
  hasDiscrepancies: boolean;
  source: string;          // Attribution: "Discrepancies identified by comparing..."
  items: Discrepancy[];
}

// AgentEvent complete type includes agent-generated output
interface AgentCompleteEvent {
  type: 'complete';
  eligibilityResult?: EligibilityResponse;
  summary?: string;                    // Agent-generated markdown
  discrepancies?: DiscrepancyReport;   // Agent-detected mismatches
  rawResponse?: unknown;               // Full Stedi 271 JSON
  usage?: AgentUsage;
}
```

---

## 6. Implementation Status

### 6.1 Completed (Phase 1, 2 & 3)

| Component | Status | Notes |
|-----------|--------|-------|
| Monorepo setup | ✅ Done | pnpm + Turborepo |
| Shared types package | ✅ Done | FHIR, eligibility, agent types |
| Database schema | ✅ Done | Prisma schema, not deployed |
| SMART OAuth flow | ✅ Done | Tested with Practice Fusion - see 6.3 |
| FHIR proxy routes | ✅ Done | Patient, Coverage, Practitioner |
| NPI validation/lookup | ✅ Done | NPPES integration |
| Claude Agent | ✅ Done | Claude Agent SDK with MCP tools |
| SSE Streaming | ✅ Done | @fastify/sse plugin, real-time events |
| Agent observability | ✅ Done | Thinking, tool calls, results in UI |
| Payer mapping memory | ✅ Done | Simple in-memory store |
| Payer search | ✅ Done | Stedi payer directory integration |
| Stedi eligibility client | ✅ Done | X12 270/271 request/response |
| Insurance discovery | ✅ Done | Stedi Insurance Discovery API |
| Insurance card parsing | ✅ Done | Claude Vision |
| Frontend UI shell | ✅ Done | All components created |
| Token service | ✅ Done | PostgreSQL storage with AES-256-GCM encryption |
| Token refresh | ✅ Done | Auto-refresh 5 minutes before expiration |
| Agent structured output | ✅ Done | Summary, discrepancies, raw response |
| Results tabbed UI | ✅ Done | Summary, Details, Raw JSON tabs |
| Discrepancy detection | ✅ Done | Agent compares input vs Stedi response |
| PDF download | ✅ Done | Client-side via browser print |
| Raw response display | ✅ Done | JSON viewer with copy/expand |

### 6.2 Pending (Phase 3 & 4)

| Component | Status | Priority |
|-----------|--------|----------|
| Database deployment | ❌ Pending | High - need PostgreSQL instance |
| Payer mapping persistence | ❌ Pending | Medium - agent memory lost on restart |
| Practice Fusion write-back | ❌ Pending | Medium - needs proprietary API docs |
| Eligibility history UI | ❌ Pending | Low |
| Audit logging wiring | ❌ Pending | Low - schema ready |
| Agent evaluations | ❌ Pending | Low |
| Multi-tenant admin UI | ❌ Pending | Low |

### 6.3 OAuth Flow - Tested & Working

The SMART on FHIR OAuth flow has been tested with Practice Fusion:

**Key Implementation Details:**
1. **Scope**: Practice Fusion requires `launch` scope (not `launch/patient`)
2. **Dynamic Discovery**: OAuth endpoints discovered from `{iss}/.well-known/smart-configuration`
3. **State Parameter**: Required for CSRF protection
4. **Token Storage**: Dual approach - sessionStorage for immediate use, PostgreSQL for persistence

**Fixes Applied:**
- `PF_SCOPES` in `.env` changed from `launch/patient` to `launch`
- dotenv path fixed to load from monorepo root (`../../../.env`)
- Next.js 14 Suspense boundaries added for `useSearchParams` pages
- Token passing: frontend stores in sessionStorage, passes as headers to FHIR proxy

**Token Storage Architecture:**
```
Frontend (sessionStorage)     →    Backend (PostgreSQL)
├── smart_access_token             ├── OAuthToken table
├── smart_fhir_base_url            ├── AES-256-GCM encryption
└── smart_refresh_token            └── Auto-refresh before expiration
```

### 6.4 Practice Fusion FHIR Data Mapping - CRITICAL

**MemberID Location (IMPORTANT):**
Practice Fusion does NOT use standard FHIR `subscriberId` field. Instead:
```json
{
  "extension": [
    {
      "url": "http://infoworld.ro/nxt/Profile/extensions#coverage-insured-unique-id",
      "valueString": "RGF112321411"  // ← REAL MEMBER ID
    }
  ],
  "subscriberId": "\\S\\0\\S\\AT"     // ← GARBAGE, IGNORE
}
```

Extraction code:
```typescript
const memberIdExtension = fhir.extension?.find(
  ext => ext.url?.includes('coverage-insured-unique-id')
);
const memberId = memberIdExtension?.valueString || '';
```

**fhirUser in id_token:**
The logged-in practitioner is in the JWT id_token's `fhirUser` claim as a full URL:
```
https://qa-api.practicefusion.com/fhir/r4/v1/{tenant}/Practitioner/{id}
```

Extract practitioner ID:
```typescript
const match = fhirUser.match(/Practitioner\/([^/]+)$/);
const practitionerId = match?.[1];
```

### 6.5 UI/UX Improvements - Implemented

| Feature | Implementation |
|---------|----------------|
| Lazy scroll dropdowns | IntersectionObserver, batch loading (15 items) |
| Parallel FHIR requests | Promise.allSettled for Patient+Coverage+Practitioner |
| Compact layout | `max-w-lg`, reduced padding for iframe |
| Editable payer | Inline edit with blur-to-save |
| Agent-driven UX | Minimal required fields, agent fills gaps |

### 6.6 SSE Streaming Implementation - Critical Details

**Server (Fastify with @fastify/sse)**:
```typescript
// Register plugin and use { sse: true } route option
await fastify.register(fastifySSE);
fastify.post('/eligibility', { sse: true }, async (request, reply) => {
  // DON'T stringify - plugin handles serialization
  await reply.sse.send({ data: { type: 'start' } });
  await reply.sse.send({ data: event }); // Pass object directly
});
```

**Client (Custom SSE parser for fetch-based POST)**:
```typescript
// Must use direct API URL - Next.js proxy buffers SSE
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
await fetchSSE(`${apiUrl}/agent/eligibility`, body, {
  onEvent: handleAgentEvent,
  onError: handleError,
  onClose: handleClose,
});
```

**Event Types**:
| Event | Purpose |
|-------|---------|
| `start` | SSE connection established |
| `thinking` | Agent's extended reasoning (streamable) |
| `text` | Agent's text response (includes final JSON output) |
| `tool_start` | Tool invocation with input |
| `tool_end` | Tool result (matches by tool name) |
| `complete` | Final result with eligibility data, summary, discrepancies, rawResponse |
| `error` | Error message |

**Complete Event Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `eligibilityResult` | EligibilityResponse | Parsed benefits/costs data |
| `summary` | string | Agent-generated markdown with source attribution |
| `discrepancies` | DiscrepancyReport | Input vs Stedi response mismatches |
| `rawResponse` | object | Full Stedi X12 271 JSON response |
| `usage` | AgentUsage | Token counts and cost estimate |

**Tool Matching**: The agent loop tracks `tool_use_id` → `tool_name` mapping because Claude SDK returns tool results with IDs, but UI matches by name.

### 6.7 Results UI - Tabbed Interface

The `EligibilityResults.tsx` component displays agent output in a tabbed interface:

**Tabs**:
| Tab | Content |
|-----|---------|
| Summary | Agent-generated markdown with source attribution + PDF download |
| Details | Structured costs (copay, deductible, OOP max, coinsurance) |
| Raw JSON | Full Stedi X12 271 response with copy/expand |

**Discrepancy Banner**:
- Displays at top when `discrepancies.hasDiscrepancies === true`
- Orange theme for warnings, red for errors
- Shows field name, input value, response value
- Agent provides suggestions for resolution

**PDF Download**:
- Client-side via browser print dialog
- Converts markdown summary to styled HTML
- No server-side PDF generation required

**Design System Colors**:
| Use | Color |
|-----|-------|
| Primary (headers, buttons) | Blue (`primary-*`) |
| Warnings/discrepancies | Orange (`orange-*`) |
| Success states | Green (`green-*`) |
| Errors | Red (`red-*`) |
| Text | Black/neutral |

---

## 7. External Dependencies

### 7.1 Practice Fusion
- **FHIR R4 API** - Patient, Coverage, Practitioner resources
- **OAuth 2.0** - SMART on FHIR authentication
- **Proprietary API** (future) - Insurance write-back, document upload

### 7.2 Stedi
- **Eligibility API** - X12 270/271 transactions
- **Payer List** (future) - For payer ID discovery

### 7.3 NPPES
- **NPI Registry API** - Public, no auth required
- **Rate limits** - Be respectful, cache results

### 7.4 Anthropic
- **Claude API** - Agent reasoning and tool use
- **Vision** - Insurance card parsing

---

## 8. Security Considerations

### 8.1 Authentication
- SMART on FHIR OAuth 2.0 with PKCE (if supported)
- State parameter for CSRF protection
- Short-lived access tokens with refresh

### 8.2 Data Protection
- Tokens encrypted at rest with AES-256-GCM (implemented)
- Encryption key from `ENCRYPTION_KEY` env var
- Key derivation using scrypt with per-encryption salt
- No PHI in logs (sanitized)
- HTTPS everywhere

### 8.3 HIPAA Compliance
- Audit logging schema ready
- Minimum necessary data access
- Session timeout (TODO)

---

## 9. Configuration

### 9.1 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `STEDI_API_KEY` | Yes | Stedi API key |
| `PF_CLIENT_ID` | Yes | Practice Fusion OAuth client ID |
| `PF_CLIENT_SECRET` | Yes | Practice Fusion OAuth client secret |
| `PF_SCOPES` | Yes | OAuth scopes (use `launch` not `launch/patient`) |
| `DATABASE_URL` | For DB | PostgreSQL connection string |
| `ENCRYPTION_KEY` | For DB | Token encryption key (generate: `openssl rand -base64 32`) |
| `DEFAULT_TENANT_ID` | For DB | Default tenant ID for single-tenant deployments |
| `NPI_REGISTRY_URL` | No | Defaults to CMS NPPES |
| `NEXT_PUBLIC_APP_URL` | Yes | Frontend URL for redirects |
| `API_URL` | Yes | Backend URL |
| `NODE_ENV` | No | development/production |

### 9.2 Agent Configuration

| Setting | Value | Location |
|---------|-------|----------|
| Max Stedi API calls | 10 | `packages/shared/src/constants` |
| Claude model | claude-sonnet-4-20250514 | `.env` or default |
| Token limit | 50000 (not enforced) | `packages/shared/src/constants` |

---

## 10. Development

### 10.1 Local Setup
```bash
# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Frontend: http://localhost:3000
# Backend: http://localhost:3001
```

### 10.2 Testing with Real SMART Launch
1. Register app with Practice Fusion
2. Configure redirect URI: `http://localhost:3000/callback`
3. Launch from EHR with `iss` and `launch` parameters
4. Complete OAuth flow
5. Verify patient data loads

### 10.3 Database Setup (When Ready)
```bash
# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Open Prisma Studio
pnpm db:studio
```

---

## 11. File Structure

```
EligibilityAgent/
├── apps/
│   ├── web/                          # Next.js Frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx              # Home
│   │   │   │   ├── launch/page.tsx       # SMART launch
│   │   │   │   ├── callback/page.tsx     # OAuth callback
│   │   │   │   └── eligibility/
│   │   │   │       ├── page.tsx          # Main UI + SSE client
│   │   │   │       └── components/
│   │   │   │           ├── AgentTracePanel.tsx  # Agent activity (blue theme)
│   │   │   │           ├── EligibilityResults.tsx # Tabbed results UI
│   │   │   │           │   ├── Summary tab (markdown + PDF download)
│   │   │   │           │   ├── Details tab (costs/benefits)
│   │   │   │           │   ├── Raw JSON tab (Stedi response)
│   │   │   │           │   └── DiscrepancyBanner (warnings)
│   │   │   │           └── ...           # Other components
│   │   │   └── lib/
│   │   │       └── sse-client.ts         # SSE parser for fetch
│   │   └── package.json
│   │
│   └── api/                          # Fastify Backend
│       ├── src/
│       │   ├── index.ts              # Server entry
│       │   ├── routes/
│       │   │   ├── auth.ts           # SMART OAuth
│       │   │   ├── fhir.ts           # FHIR proxy
│       │   │   ├── npi.ts            # NPI lookup
│       │   │   ├── agent.ts          # SSE endpoint for agent
│       │   │   ├── eligibility.ts    # Save/history
│       │   │   └── card-parse.ts     # Card OCR
│       │   ├── services/
│       │   │   ├── agent/
│       │   │   │   ├── loop.ts       # Agent loop with SDK
│       │   │   │   ├── tools.ts      # Tool type definitions
│       │   │   │   ├── executor.ts   # Tool execution dispatch
│       │   │   │   └── prompt.ts     # System prompt
│       │   │   ├── stedi.ts          # Stedi eligibility client
│       │   │   ├── payer-search.ts   # Stedi payer directory
│       │   │   ├── insurance-discovery.ts # Stedi discovery
│       │   │   ├── npi.ts            # NPPES client
│       │   │   ├── payer-mapping.ts  # Memory store
│       │   │   └── token-service.ts  # PostgreSQL token storage
│       │   └── lib/
│       │       └── encryption.ts     # AES-256-GCM encryption
│       └── package.json
│
├── packages/
│   ├── shared/                       # Shared types
│   │   └── src/
│   │       ├── types/index.ts
│   │       └── constants/index.ts
│   └── db/                           # Database
│       ├── prisma/schema.prisma
│       └── src/index.ts
│
├── Documentation/                    # Reference docs
├── .env                              # Configuration
├── SPECIFICATION.md                  # This file
├── CLAUDE.md                         # Claude Code guidance
└── README.md                         # Quick start
```

---

## 12. Deployment

### 12.1 Infrastructure (Fly.io)

The application is deployed to Fly.io with automatic CI/CD via GitHub Actions.

| Component | Fly App | URL |
|-----------|---------|-----|
| Web (Next.js) | `eligibility-web` | https://eligibility.practicefusionpm.com |
| API (Fastify) | `eligibility-api` | https://api.eligibility.practicefusionpm.com |
| PostgreSQL | `eligibility-db` | Attached to API |

### 12.2 Configuration Files

| File | Purpose |
|------|---------|
| `fly.api.toml` | Fly configuration for API (root level) |
| `fly.web.toml` | Fly configuration for Web (root level) |
| `apps/api/Dockerfile` | API container build |
| `apps/web/Dockerfile` | Web container build (Next.js standalone) |
| `.github/workflows/deploy.yml` | GitHub Actions auto-deploy on push to main |

### 12.3 Deployment Commands

```bash
# Manual deploy API
flyctl deploy --config fly.api.toml --remote-only

# Manual deploy Web
flyctl deploy --config fly.web.toml --remote-only \
  --build-arg NEXT_PUBLIC_APP_URL=https://eligibility.practicefusionpm.com \
  --build-arg NEXT_PUBLIC_API_URL=https://api.eligibility.practicefusionpm.com

# View logs
flyctl logs --app eligibility-api
flyctl logs --app eligibility-web

# SSH into machine
flyctl ssh console --app eligibility-api

# Database console
flyctl postgres connect -a eligibility-db
```

### 12.4 Secrets (Fly.io)

All secrets set via `flyctl secrets set --app <app>`:

**API Secrets:**
- `ANTHROPIC_API_KEY`
- `STEDI_API_KEY`
- `PF_CLIENT_ID`
- `PF_CLIENT_SECRET`
- `PF_SCOPES`
- `ENCRYPTION_KEY`
- `DATABASE_URL` (auto-attached from PostgreSQL)
- `CORS_ORIGIN`
- `NEXT_PUBLIC_APP_URL`

**Web Secrets:**
- Set at build time via `--build-arg` in deploy workflow

---

## 13. Roadmap

See `ROADMAP.md` for detailed feature roadmap including:

### 13.1 Current Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| Summary only on `complete` event | HIGH | Users wait for entire agent run to see results |
| Extended thinking not enabled | HIGH | Agent can't reason deeply about complex problems |
| No structured multi-turn input | HIGH | Can't handle ambiguous scenarios (multiple NPIs, multiple insurances) |
| Source attribution embedded in text | MEDIUM | No verification or highlighting of source |
| Tool matching by name not ID | MEDIUM | Wrong grouping if same tool called twice |
| No agent state machine | MEDIUM | Users don't know what phase agent is in |

### 13.2 Planned Epics

1. **Agent State Machine & Structured Output** - Explicit states, structured responses
2. **Multi-Turn Selection Handling** - NPI disambiguation, insurance plan selection, payer resolution
3. **Enhanced Thinking & Reasoning** - Extended thinking API, streaming thinking blocks
4. **Source Attribution & Verification** - Structured source data, verification badges
5. **UX Polish & State Visibility** - Journey progress, tool ID tracking, preview summaries
6. **Error Handling & Recovery** - Retry mechanisms, partial results, recovery options

### 13.3 Agent State Machine (Planned)

```typescript
// Planned agent states
type AgentState =
  | 'ANALYZING'      // Reviewing provided data
  | 'NEED_SELECTION' // User must choose from options
  | 'NEED_INPUT'     // Additional information required
  | 'EXECUTING'      // Performing tool calls
  | 'COMPLETED'      // Eligibility check complete
  | 'ERROR';         // Something went wrong

// Structured response for selections
interface SelectionRequest {
  field: 'provider_npi' | 'payer' | 'insurance_plan';
  options: Array<{
    id: string;
    label: string;
    details: Record<string, unknown>;
  }>;
  prompt: string;
}

// Agent response structure
interface AgentResponse {
  state: AgentState;
  selection?: SelectionRequest;      // For NEED_SELECTION
  inputRequest?: InputRequest;       // For NEED_INPUT
  result?: EligibilityResult;        // For COMPLETED
}
```

---

## 14. Technical Debt

- Remove unused dependencies (cleanup package.json)
- Add `DEFAULT_TENANT_ID` setup for database foreign key constraint
- Add scheduled cleanup for expired tokens
- Persist payer mappings to database (schema ready, service not implemented)
- Add tool use ID tracking for proper matching

---

## 15. Open Questions

1. **Practice Fusion proprietary API** - Need documentation for insurance write-back and document upload endpoints
2. **Stedi payer list** - Should we query Stedi's payer list API for better mapping?
3. **Multi-tenant** - Is this needed for MVP or single-practice deployment?
4. **Offline mode** - Should app work if Stedi is down? (show last known eligibility)

---

## 16. Code Audit (January 2026)

See `CODE_AUDIT.md` for full audit report.

### 16.1 Summary

| Category | Status | Critical Issues |
|----------|--------|-----------------|
| Test Coverage | **CRITICAL** | Zero automated tests |
| Code Quality | **MEDIUM** | 25+ console.log statements |
| Performance | **HIGH** | Blocking crypto, no caching |
| Security/Privacy | **CRITICAL** | PHI logging, no rate limiting |
| Logging/Monitoring | **CRITICAL** | No monitoring infrastructure |
| Dependencies | **LOW** | 2 unused packages |

### 16.2 Security Issues

**CRITICAL - Must Fix Before Production:**

| Issue | Risk | Location |
|-------|------|----------|
| PHI logged to stdout | HIPAA violation | `services/stedi.ts:212,227`, `services/agent/executor.ts:28` |
| No authorization on agent endpoint | Unauthenticated access to PHI | `routes/agent.ts:90` |
| No rate limiting | DoS, cost abuse | All endpoints |
| AuditLog never populated | HIPAA compliance | `prisma/schema.prisma` (table unused) |
| JWT ID token not verified | User impersonation | `routes/auth.ts:250-280` |

### 16.3 Performance Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| `scryptSync` blocks event loop | Request latency under load | Move to worker thread |
| Missing database indexes | Slow token lookups | Add `@@index([tenantId, patientId])` |
| Payer mappings lost on restart | Re-discovery costs | Persist to PostgreSQL |
| NPI lookups not cached | Repeated API calls | Add LRU cache |

### 16.4 Test Coverage

**Current:** 0% - No test framework configured

**Required:**
- Unit tests for encryption, NPI validation, Stedi parsing
- Integration tests for agent loop, OAuth flow
- E2E tests for eligibility check workflow

### 16.5 Dependencies

**Unused (remove):**
- `pdfkit` (0.16.0) - Leftover code
- `@types/pdfkit` (0.13.9)

**Missing:**
- Test framework (jest/vitest)
- Rate limiting (`@fastify/rate-limit`)
- Log aggregation (Grafana/DataDog integration)
