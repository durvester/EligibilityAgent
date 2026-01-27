# CLAUDE.md

Guidance for Claude Code when working with this repository.

See `SPECIFICATION.md` for detailed technical documentation.

---

## Quick Reference

### Commands
```bash
pnpm install          # Install dependencies
pnpm dev              # Start both apps (web :3000, api :3001)
pnpm dev:web          # Frontend only
pnpm dev:api          # Backend only
pnpm build            # Build all packages
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema to database
```

### Project Structure
```
apps/web/             # Next.js frontend
apps/api/             # Fastify backend
packages/shared/      # TypeScript types and constants
packages/db/          # Prisma schema and client
Documentation/        # Reference documentation
fly.api.toml          # Fly.io API config
fly.web.toml          # Fly.io Web config
ROADMAP.md            # Feature roadmap with epics
CODE_AUDIT.md         # Security, performance, quality audit
```

---

## Architecture Overview

### SMART on FHIR Flow
1. EHR launches app with `iss` (FHIR base URL) and `launch` token
2. Backend discovers OAuth endpoints from `{iss}/.well-known/smart-configuration`
3. User authorizes, callback exchanges code for token
4. Token response includes `fhirBaseUrl` for subsequent FHIR calls
5. Frontend stores token in sessionStorage, passes headers on all API calls
6. Backend stores encrypted tokens in PostgreSQL (when `DATABASE_URL` configured)
7. Token refresh happens automatically 5 minutes before expiration

**Practice Fusion Specifics:**
- Use `launch` scope, NOT `launch/patient`
- OAuth scopes in `.env`: `PF_SCOPES="launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read user/Practitioner.read patient/Organization.read patient:r_insurance_v3"`

### Agent Flow
1. Frontend submits patient/insurance/provider data to `/api/agent/eligibility`
2. Agent validates NPI via NPPES
3. Agent checks memory for known payer mapping
4. Agent determines Stedi payer ID (from memory, search, or discovery)
5. **Critical**: If using discovery, agent MUST then call `check_eligibility` (discovery is means, eligibility is goal)
6. Agent submits eligibility check to Stedi
7. Agent saves successful mapping to memory
8. Agent generates structured JSON output with:
   - Summary (markdown with source attribution)
   - Discrepancies (input vs response mismatches)
   - Eligibility data (parsed benefits)
   - Raw response (full Stedi X12 271)
9. Results streamed back via SSE with complete event containing all output

---

## Key Design Decisions

### Practice Fusion FHIR Specifics

**MemberID Location** (CRITICAL):
```
Coverage.extension[url="...#coverage-insured-unique-id"].valueString
```
NOT `Coverage.subscriberId` (contains garbage `\S\0\S\AT`)

**fhirUser Extraction**:
```typescript
// id_token contains fhirUser as full URL
const fhirUser = "https://...Practitioner/627b9ead-07b0-4ce3-9a15-474993cfbaa7"
const match = fhirUser.match(/Practitioner\/([^/]+)$/);
const practitionerId = match?.[1]; // "627b9ead-07b0-4ce3-9a15-474993cfbaa7"
```

### No Hardcoded URLs
- OAuth endpoints discovered from `iss` parameter
- FHIR base URL comes from launch context
- Frontend must pass `X-FHIR-Base-URL` header on FHIR requests

### No Fallbacks
- If data is missing, return empty and let UI handle
- Don't chain fallbacks that produce garbage data
- Fail explicitly rather than silently with wrong data

### Agent Memory (Payer Mapping)
- Simple in-memory store (lost on restart)
- Agent uses its knowledge to guess Stedi payer IDs
- Successful mappings saved for future checks
- No hardcoded payer mappings
- Future: persist to `payer_mappings` table in PostgreSQL

### Token Storage
- **Frontend**: sessionStorage for immediate access after OAuth callback
- **Backend**: PostgreSQL with AES-256-GCM encryption (when `DATABASE_URL` configured)
- **Refresh**: Auto-refresh 5 minutes before expiration using refresh token
- **Encryption key**: Set `ENCRYPTION_KEY` env var (generate: `openssl rand -base64 32`)

### Streaming Responses
- Agent endpoint uses Server-Sent Events (SSE)
- Each tool call sent as step update
- Final result sent when complete
- Enables real-time UI updates

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/api/src/routes/auth.ts` | SMART OAuth with dynamic discovery |
| `apps/api/src/routes/agent.ts` | SSE endpoint for eligibility agent |
| `apps/api/src/routes/fhir.ts` | FHIR proxy (requires headers) |
| `apps/api/src/services/agent/loop.ts` | Agent loop using direct Anthropic SDK |
| `apps/api/src/services/agent/tools.ts` | Tool definitions (JSON schema) |
| `apps/api/src/services/agent/executor.ts` | Tool execution dispatch |
| `apps/api/src/services/agent/prompt.ts` | System prompt and data context builder |
| `apps/api/src/services/stedi.ts` | Stedi X12 270/271 client |
| `apps/api/src/services/payer-mapping.ts` | Agent memory store (in-memory) |
| `apps/api/src/services/payer-search.ts` | Stedi payer directory search |
| `apps/api/src/services/token-service.ts` | PostgreSQL token storage with refresh |
| `apps/api/src/lib/encryption.ts` | AES-256-GCM token encryption |
| `apps/web/src/app/eligibility/page.tsx` | Main eligibility UI with SSE client |
| `apps/web/src/lib/sse-client.ts` | Robust SSE parser for fetch-based streams |
| `apps/web/src/app/eligibility/components/AgentTracePanel.tsx` | Real-time agent activity display (blue theme) |
| `apps/web/src/app/eligibility/components/EligibilityResults.tsx` | Tabbed results UI (Summary, Details, Raw JSON) |
| `packages/shared/src/types/index.ts` | All TypeScript types (includes Discrepancy, DiscrepancyReport) |
| `packages/db/prisma/schema.prisma` | Database schema |

---

## API Patterns

### Request Headers (FHIR endpoints)
```
Authorization: Bearer <access_token>
X-FHIR-Base-URL: <fhir_base_url from token response>
```

### Response Format
```typescript
// Success
{ success: true, data: {...} }

// Error
{ success: false, error: { code: 'ERROR_CODE', message: '...' } }
```

### SSE Streaming (Agent)
```
data: {"type":"start"}
data: {"type":"thinking","thinking":"..."}
data: {"type":"tool_start","tool":"lookup_npi","input":{...}}
data: {"type":"tool_end","tool":"lookup_npi","result":{...}}
data: {"type":"text","text":"Agent's final output with JSON..."}
data: {"type":"complete","eligibilityResult":{...},"summary":"# Eligibility Summary...","discrepancies":{...},"rawResponse":{...},"usage":{...}}
```

**Important**: Don't `JSON.stringify()` when using `@fastify/sse` - the plugin handles serialization.

**Complete Event Structure**:
- `eligibilityResult`: Parsed eligibility data (status, copay, deductible, etc.)
- `summary`: Agent-generated markdown summary with source attribution
- `discrepancies`: Agent-detected mismatches between input and Stedi response
- `rawResponse`: Full Stedi X12 271 JSON response
- `usage`: Token counts and cost estimate

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

### New Shared Type
1. Add to `packages/shared/src/types/index.ts`
2. Re-export from `packages/shared/src/index.ts`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API |
| `STEDI_API_KEY` | Yes | Stedi eligibility |
| `PF_CLIENT_ID` | Yes | Practice Fusion OAuth |
| `PF_CLIENT_SECRET` | Yes | Practice Fusion OAuth |
| `PF_SCOPES` | Yes | OAuth scopes (use `launch` not `launch/patient`) |
| `DATABASE_URL` | For DB | PostgreSQL connection string |
| `ENCRYPTION_KEY` | For DB | Token encryption (generate: `openssl rand -base64 32`) |
| `DEFAULT_TENANT_ID` | For DB | Default tenant ID for single-tenant mode |
| `NEXT_PUBLIC_APP_URL` | Yes | Frontend URL |
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL for SSE (bypasses Next.js proxy) |
| `API_URL` | Yes | Backend URL (server-side) |
| `CORS_ORIGIN` | No | Allowed CORS origin (empty = env default) |

---

## What's Not Done Yet

See `ROADMAP.md` for detailed feature roadmap with epics and stories.
See `SPECIFICATION.md` Section 6.2 for implementation status.

**High Priority (Roadmap Phase 1-2):**
- Extended thinking API enablement
- Agent state machine with structured output
- Multi-turn selection handling (NPI/payer/insurance disambiguation)
- Tool use ID tracking for proper matching

**Medium Priority:**
- Payer mapping database persistence (schema ready, service not implemented)
- Summary preview during execution (not just on complete)
- Source attribution as structured data (not embedded in text)

**Low Priority:**
- Practice Fusion proprietary API integration (insurance write-back)
- Eligibility history UI
- Agent evaluations

---

## Code Audit Summary

See `CODE_AUDIT.md` for full audit report covering security, performance, and quality.

### Critical Issues (Must Fix Before Production PHI)

| Issue | Category | Location |
|-------|----------|----------|
| PHI logged to stdout | Security | `services/stedi.ts`, `services/agent/executor.ts` |
| No route authorization | Security | `routes/agent.ts`, `routes/eligibility.ts` |
| Zero automated tests | Quality | Entire codebase |
| No rate limiting | Security | All API endpoints |
| Blocking crypto | Performance | `lib/encryption.ts` |
| No audit trail | Compliance | `AuditLog` table unused |

### Key Findings

- **Test Coverage**: 0% - No test framework configured
- **Console.log statements**: 25+ should be replaced with Fastify logger
- **Security**: PHI (names, DOBs, member IDs) logged; missing authorization on agent endpoint
- **Performance**: Synchronous scrypt blocks event loop; missing database indexes
- **Dependencies**: `pdfkit` unused; missing env validation at startup

### Before Accepting PRs

1. Run `pnpm build` - must pass
2. No new `console.log` statements (use `fastify.log`)
3. No PHI in logs (mask or omit sensitive data)
4. Add tests for new functionality

## What's Done

- **Deployment**: Fly.io with auto-deploy via GitHub Actions
- **Custom domains**: eligibility.practicefusionpm.com + api subdomain with SSL
- **Agent rewrite**: Direct Anthropic SDK (removed Claude Agent SDK dependency)
- PDF download: Client-side via browser print (no server-side PDF generation needed)
- Agent summary generation: Agent creates markdown summary with source attribution
- Discrepancy detection: Agent compares input vs Stedi response and flags mismatches
- Raw response display: Full Stedi X12 271 JSON visible in UI

## Recent Progress (Jan 2026)

### Session 1: OAuth & Token Storage
1. **OAuth Flow Working**: Tested with Practice Fusion, all issues resolved
2. **Token Storage**: PostgreSQL storage with AES-256-GCM encryption implemented
3. **Token Refresh**: Auto-refresh before expiration implemented
4. **Bug Fixes**:
   - Changed `PF_SCOPES` from `launch/patient` to `launch` (Practice Fusion requirement)
   - Fixed dotenv path to load from monorepo root
   - Added Suspense boundaries for Next.js 14 `useSearchParams`
   - Fixed TypeScript issues in AgentTracePanel and FHIR routes

### Session 2: FHIR Data Extraction & UI Improvements

1. **MemberID Extraction Fixed**:
   - Practice Fusion stores member ID in extension `coverage-insured-unique-id`, NOT `subscriberId`
   - `subscriberId` contains garbage value `\S\0\S\AT`
   - Now correctly extracts from extension

2. **Practitioner/fhirUser Fixed**:
   - JWT id_token decoded to extract `fhirUser` claim
   - Full URL parsed: `https://...Practitioner/{id}` → extract ID
   - Logged-in practitioner correctly populated

3. **Parallel FHIR Requests**:
   - Patient, Coverage, Practitioner fetched in parallel via `Promise.allSettled`
   - Reduced load time from ~3s sequential to ~1s parallel

4. **Lazy Scroll Dropdowns**:
   - ProviderInfo: Custom dropdown with IntersectionObserver for lazy loading
   - ServiceTypeSelect: Same pattern, shows 15 items initially, loads more on scroll
   - Clean UI without native `<select>` clutter

5. **UI Improvements**:
   - Compact layout for iframe (`max-w-lg`, reduced padding)
   - Payer name editable with inline edit
   - Patient card responsive with truncation
   - NPIs hidden from dropdown - maintained elegance

6. **Agent-Driven Philosophy**:
   - Minimum required fields (just patient + memberId)
   - Agent looks up NPI via NPPES if missing
   - Agent handles payer mapping
   - "Will be looked up automatically" messaging

### Session 3: SSE Streaming & Agent UI (Jan 2026)

1. **SSE Streaming Fixed**:
   - Integrated `@fastify/sse` plugin for proper SSE handling
   - Fixed double JSON encoding issue (plugin handles serialization, don't call `JSON.stringify()`)
   - Uses Route Handler proxy (`/api/agent/eligibility`) which properly forwards cookies
   - For async generators, use `reply.sse()` not `reply.sse.send()`

2. **Anthropic SDK Integration**:
   - Using `@anthropic-ai/sdk` with direct messages API and tool use
   - Tool use ID to name tracking for matching tool_start/tool_end events
   - Agentic loop with conversation history and tool result handling

3. **Agent Trace Panel**:
   - Real-time display of agent reasoning (thinking blocks)
   - Tool calls show input parameters and results
   - Proper completion states (spinning → checkmark/X)
   - Expandable view for detailed inspection

4. **Key SSE Implementation Notes**:
   ```typescript
   // Server: reply.sse.send() accepts AsyncIterable<SSEMessage> for streaming
   async function* eventStream() {
     yield { data: { type: 'start' } };  // SSEMessage format
     for await (const event of runAgent()) {
       yield { data: event };
     }
   }
   return reply.sse.send(eventStream()); // Streams async iterable

   // Client: Uses Route Handler proxy (forwards cookies correctly)
   await fetchSSE('/api/agent/eligibility', body, options);
   ```

5. **Code Cleanup**:
   - Removed debug console.log statements
   - Replaced with structured Fastify logging
   - Production-ready error handling

### Session 4: Agent Output & Results UI (Jan 2026)

1. **Agent Structured Output**:
   - System prompt updated to enforce discovery → eligibility flow
   - Agent MUST call `check_eligibility` after `discover_insurance` (discovery is means, eligibility is goal)
   - Agent generates structured JSON with summary, discrepancies, eligibility data, and raw response
   - Output parsed from agent's final text block (```json code block)

2. **New Types Added** (`packages/shared/src/types/index.ts`):
   ```typescript
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
   ```

3. **AgentEvent Updated**:
   - `complete` event now includes: `summary`, `discrepancies`, `rawResponse`
   - Summary is markdown with source attribution
   - Discrepancies compare input data vs Stedi response

4. **EligibilityResults Redesigned**:
   - **Tabbed interface**: Summary | Details | Raw JSON
   - **Discrepancy banner**: Orange warnings at top when mismatches detected
   - **Markdown renderer**: Displays agent-generated summary
   - **JSON viewer**: Expandable raw Stedi 271 response with copy button
   - **PDF download**: Browser print dialog for summary

5. **Color Scheme Fixed**:
   - Removed purple "AI slop" colors from AgentTracePanel
   - Thinking blocks now use `primary-*` (blue) classes
   - Discrepancies use orange (`orange-*`) for warnings
   - Consistent with design system: blue primary, orange accent

6. **Source Attribution**:
   - Summary footer: "Based on X12 271 eligibility response from [PayerName] via Stedi API, checked [date]"
   - Discrepancies header: "Discrepancies identified by comparing provided input against X12 271 response from [PayerName]"

7. **Raw Response Exposed**:
   - `rawResponse` now passed through from Stedi service → executor → agent loop → UI
   - Available in "Raw JSON" tab for debugging/verification

### Session 5: Deployment & Roadmap (Jan 2026)

1. **Fly.io Deployment**:
   - API deployed to `eligibility-api` at https://api.eligibility.practicefusionpm.com
   - Web deployed to `eligibility-web` at https://eligibility.practicefusionpm.com
   - PostgreSQL database attached (`eligibility-db`)
   - SSL certificates auto-provisioned

2. **GitHub Actions CI/CD**:
   - `.github/workflows/deploy.yml` created
   - Auto-deploys on push to `main` branch
   - Deploys API first, then Web (Web depends on API)
   - Build args for Next.js public URLs

3. **Agent SDK Rewrite**:
   - **CRITICAL**: `@anthropic-ai/claude-agent-sdk` spawns Claude Code CLI as subprocess
   - This doesn't work in Docker (Claude Code binary not available)
   - Rewrote `loop.ts` to use `@anthropic-ai/sdk` directly with messages API
   - Agentic loop: message → tool_use → execute → tool_result → repeat until done

4. **Docker Builds**:
   - Multi-stage Dockerfiles for both API and Web
   - pnpm monorepo requires copying workspace-level node_modules
   - Next.js uses `output: 'standalone'` for smaller images
   - API Dockerfile copies `apps/api/node_modules` (pnpm hoisting)

5. **Configuration Files Created**:
   - `fly.api.toml` - API app config (root level)
   - `fly.web.toml` - Web app config (root level)
   - `apps/api/Dockerfile` - API container
   - `apps/web/Dockerfile` - Web container
   - `.github/workflows/deploy.yml` - CI/CD pipeline

6. **Roadmap Created** (`ROADMAP.md`):
   - Documents current issues and severity
   - 6 epics covering state machine, multi-turn, thinking, attribution, UX, errors
   - 4-phase timeline with prioritized stories
   - Technical debt tracking
