# Eligibility Agent Roadmap

## Current State (January 2026)

### Completed Phases (1-4)

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Database Schema & Foundation Services | ✅ Complete |
| 2 | Internal JWT & Cookie Auth | ✅ Complete |
| 3 | Audit Logging & Agent Output Storage | ✅ Complete |
| 4 | Redis Caching & Rate Limiting | ✅ Complete |

### What's Working
- **Tenant-centric architecture**: Issuer (FHIR base URL) = Practice = Tenant
- **Two-token authentication**: Internal JWT (cookie) + PF tokens (encrypted in DB)
- **Session management**: Middleware validates JWT, attaches session to request
- **Token refresh**: Retry-on-401 pattern with stored tokenEndpoint
- **FHIR Integration**: Patient, Coverage, Practitioner with retry-on-401
- **Agent Tool Execution**: NPI lookup (Redis cached), payer search, eligibility checks
- **HIPAA Audit Logging**: Fire-and-forget, tenant-scoped
- **Rate Limiting**: 100/min general, 10/min for agent endpoints
- **SSE Streaming**: Events flow from agent to UI in real-time
- **Deployment**: Fly.io with GitHub Actions auto-deploy

### Remaining Issues (Agent UX)

| Issue | Severity | Impact |
|-------|----------|--------|
| Summary only on `complete` event | HIGH | Users wait for entire agent run to see results |
| Extended thinking not enabled | HIGH | Agent can't reason deeply about complex problems |
| No structured multi-turn input | HIGH | Can't handle ambiguous scenarios (multiple NPIs, multiple insurances) |
| Source attribution embedded in text | MEDIUM | No verification or highlighting of source |
| Tool matching by name not ID | MEDIUM | Wrong grouping if same tool called twice |
| No agent state machine | MEDIUM | Users don't know what phase agent is in |

---

## Epics & Stories

### Epic 1: Agent State Machine & Structured Output
**Goal**: Define explicit agent states and structured responses for each state.

#### Story 1.1: Define Agent States
```
States:
- ANALYZING: Agent reviewing provided data
- NEED_SELECTION: Agent needs user to choose from options
- NEED_INPUT: Agent needs additional information
- EXECUTING: Agent performing tool calls
- COMPLETED: Eligibility check complete
- ERROR: Something went wrong
```

#### Story 1.2: Structured Output Schema
```typescript
interface AgentResponse {
  state: AgentState;
  // For NEED_SELECTION
  selection?: {
    field: 'provider_npi' | 'payer' | 'insurance_plan';
    options: Array<{ id: string; label: string; details: Record<string, unknown> }>;
    prompt: string;
  };
  // For NEED_INPUT
  inputRequest?: {
    fields: Array<{ name: string; label: string; type: 'text' | 'date' | 'select'; required: boolean }>;
    prompt: string;
  };
  // For COMPLETED
  result?: {
    summary: string;
    source: { payer: string; timestamp: string; responseId: string };
    eligibility: EligibilityResponse;
    discrepancies: DiscrepancyReport;
  };
}
```

#### Story 1.3: Update System Prompt for State Machine
- Agent MUST output state in every response
- Agent MUST use structured format for selections
- Agent MUST NOT use free text for user interaction

---

### Epic 2: Multi-Turn Selection Handling
**Goal**: Handle scenarios where agent finds multiple valid options.

#### Story 2.1: Multiple NPI Resolution
- When `search_npi` returns multiple providers, agent enters `NEED_SELECTION` state
- UI renders selection cards with provider details (name, specialty, address)
- User selection is sent back to agent as structured input
- Agent continues with selected NPI

#### Story 2.2: Multiple Insurance Plans from Discovery
- When `discover_insurance` returns multiple plans, agent enters `NEED_SELECTION` state
- UI renders insurance cards (medical, dental, vision separated)
- User can select which plan to check
- Agent runs eligibility on selected plan

#### Story 2.3: Payer Ambiguity Resolution
- When `search_payers` returns multiple matches, agent enters `NEED_SELECTION` state
- UI shows payer options with IDs
- User selects correct payer
- Agent saves mapping and continues

---

### Epic 3: Enhanced Thinking & Reasoning
**Goal**: Enable and display Claude's extended thinking.

#### Story 3.1: Enable Extended Thinking in API
```typescript
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 8192,
  thinking: {
    type: 'enabled',
    budget_tokens: 10000,
  },
  // ...
});
```

#### Story 3.2: Stream Thinking Blocks Properly
- Emit thinking blocks as they arrive (not just at end)
- Include thinking phase indicator (initial analysis vs. tool result analysis)
- Add sequence numbers to thinking blocks

#### Story 3.3: Thinking Display Improvements
- Auto-scroll to latest content
- Show thinking as expandable cards
- Indicate when agent is "thinking" vs "executing"

---

### Epic 4: Source Attribution & Verification
**Goal**: Make source attribution explicit and verifiable.

#### Story 4.1: Structured Source in Response
```typescript
interface SourceAttribution {
  payer: string;
  payerId: string;
  timestamp: string;
  transactionId: string;
  responseFormat: 'X12_271';
  stediRequestId?: string;
}
```

#### Story 4.2: UI Source Display
- Dedicated "Source" section in results
- Show payer name, check timestamp, transaction ID
- Link to raw response tab
- "Verified via Stedi API" badge

#### Story 4.3: Raw Response Viewer Enhancement
- Syntax highlighted JSON
- Collapsible sections for large responses
- Copy button for support tickets

---

### Epic 5: UX Polish & State Visibility
**Goal**: Users always know what's happening.

#### Story 5.1: Agent Journey Progress
- Visual stepper showing: Analyzing → Verifying → Checking → Complete
- Current step highlighted with animation
- Estimated time remaining (based on typical durations)

#### Story 5.2: Tool Use ID Tracking
- Include `toolUseId` in `tool_start` and `tool_end` events
- Match tool results correctly even with parallel calls
- Show tool execution duration

#### Story 5.3: Summary Preview During Execution
- Show partial summary as soon as eligibility result arrives
- Update summary as agent analyzes
- Final polish when `complete` event arrives

#### Story 5.4: Auto-Scroll Trace Panel
- Scroll to newest step automatically
- "Jump to latest" button when user scrolls up
- Sticky header showing current activity

---

### Epic 6: Error Handling & Recovery
**Goal**: Graceful handling of failures with recovery options.

#### Story 6.1: Retry Mechanisms
- Retry failed tool calls with exponential backoff
- User-initiated retry for specific tools
- "Try different payer" option on eligibility failure

#### Story 6.2: Partial Results
- Show what we learned even if eligibility check fails
- Display NPI verification results
- Show payer search results

#### Story 6.3: Error State UI
- Clear error messages with suggested actions
- "Contact support" with pre-filled context
- Option to start over or retry specific step

---

---

## Infrastructure Phases (Remaining)

### Phase 5: Testing & Playwright E2E

**Goal**: Establish comprehensive test coverage for CI/CD confidence.

#### Story 5.1: Unit Tests (Jest)
- JWT sign/verify, expiration, invalid signature
- Session CRUD, JWT issuance, refresh
- Fire-and-forget audit behavior
- X12 271 parsing, benefit extraction
- OAuth callback, tenant creation, cookie setting

#### Story 5.2: Integration Tests
- Agent loop with mock Anthropic responses
- FHIR proxy with retry-on-401
- Session middleware validation

#### Story 5.3: E2E Tests (Playwright)
- OAuth flow end-to-end
- Eligibility check workflow
- SSE streaming verification

#### Story 5.4: CI Pipeline Updates
- Run unit tests on every PR
- Run E2E tests before deploy
- Block deploys on test failures

---

### Phase 6: Code Quality & Type Safety

**Goal**: Clean up code quality issues for maintainability.

#### Story 6.1: Remove Console.log
- Replace all console.log with Fastify logger
- Frontend: Remove debug logs or use proper error boundaries

#### Story 6.2: ESLint Strict Mode
- Enable `no-console: error`
- Enable `@typescript-eslint/no-explicit-any: error`
- Add to CI pipeline (block on warnings)

#### Story 6.3: Type Safety
- Create `StediEligibilityResponse` interface from API schema
- Type all FHIR extensions properly
- Remove all `any` types from codebase

#### Story 6.4: Remove Hardcoded Fallbacks
- Fail explicitly if config missing (no localhost fallbacks)
- Validate all required env vars at startup

---

### Phase 7: Monitoring, Alerting & Fly.io Integration

**Goal**: Production observability and proactive alerting.

#### Story 7.1: Health Check Enhancement
- Return DB + Redis status with latency
- Return 503 if any dependency unhealthy
- Add version/commit info to health response

#### Story 7.2: Log Drain to Grafana
- Configure Fly.io log shipping to Grafana Cloud
- Set up log aggregation dashboards

#### Story 7.3: Fly.io Metrics
- Enable Prometheus endpoint
- Configure key metrics (request latency, error rate)

#### Story 7.4: Alerting
- Error rate > 5% over 5 minutes
- p99 latency > 10 seconds
- Machine restarts
- Health check failures

---

## Agent UX Phases (Future)

### Agent Phase 1: Critical Fixes
1. Story 3.1: Enable Extended Thinking
2. Story 4.1: Structured Source Attribution
3. Story 5.2: Tool Use ID Tracking
4. Story 5.4: Auto-Scroll Trace Panel

### Agent Phase 2: State Machine
1. Story 1.1: Define Agent States
2. Story 1.2: Structured Output Schema
3. Story 1.3: Update System Prompt
4. Story 5.1: Agent Journey Progress

### Agent Phase 3: Multi-Turn Selection
1. Story 2.1: Multiple NPI Resolution
2. Story 2.2: Multiple Insurance Plans
3. Story 2.3: Payer Ambiguity Resolution

### Agent Phase 4: Polish
1. Story 5.3: Summary Preview
2. Story 6.1: Retry Mechanisms
3. Story 6.2: Partial Results
4. Story 6.3: Error State UI

---

## Technical Debt

### Resolved (Phases 1-4)
- ~~No route authorization~~ → Session middleware
- ~~No rate limiting~~ → @fastify/rate-limit
- ~~No audit trail~~ → Fire-and-forget logging
- ~~Missing env validation~~ → validateEnvironmentOrExit()
- ~~NPI lookups not cached~~ → Upstash Redis

### Remaining
- Remove `@anthropic-ai/claude-agent-sdk` dependency (no longer used)
- Remove `pdfkit` dependency (unused)
- Add scheduled cleanup for expired tokens/sessions
- Persist payer mappings to database (schema ready, service not implemented)
