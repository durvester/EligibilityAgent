# Building an AI Agent for Insurance Eligibility Verification

## The Problem Nobody Wants to Solve

Insurance eligibility verification is tedious. Before every appointment, practice staff must confirm a patient's coverage is active, understand their benefits, and identify any discrepancies that might cause claim denials. The process typically involves phone calls to payers, logging into multiple portals, and manually cross-referencing data from the EHR.

The technical challenge is deceptively complex. A practice might record the same payer as "Aetna", "AETNA PPO", "Aetna Better Health", or simply "Aetna Inc." in their EHR. Each variation must map to a specific payer identifier that clearinghouses recognise for X12 270/271 eligibility transactions. No deterministic lookup table exists for this mapping because the source data is fundamentally inconsistent.

This is precisely the sort of problem where an AI agent earns its keep: handling ambiguity, reasoning across multiple data sources, and producing structured output from unstructured inputs.

## What We Built

The Eligibility Agent is a SMART on FHIR application that launches directly within Practice Fusion's EHR. When a staff member opens a patient's chart, they can trigger an eligibility check without leaving their workflow.

The core innovation is a Claude-powered agent that autonomously:

1. Validates the rendering provider's NPI against the NPPES registry
2. Resolves the EHR's inconsistent payer name to a valid Stedi payer identifier (using search, cached mappings, or insurance discovery as needed)
3. Submits an X12 270 eligibility request via Stedi
4. Parses the 271 response into structured benefits data
5. Detects discrepancies between submitted and returned data (name mismatches, member ID corrections)
6. Generates a summary with source attribution

The agent's reasoning is streamed to the UI in real-time via Server-Sent Events, providing full observability into its decision-making process. Staff see which tools the agent invokes, what data it retrieves, and how it arrives at its conclusions.

## How We Built It

**Architecture**

The system follows a monorepo structure with clear separation: Next.js 14 frontend, Fastify 5 API, shared TypeScript types, and Prisma for database access. Turborepo handles builds and task orchestration.

Authentication uses a two-token approach. An internal JWT (15-minute expiry, HttpOnly cookie) authenticates API requests. Practice Fusion's OAuth tokens are encrypted with AES-256-GCM and stored in PostgreSQL, used exclusively for FHIR API calls. The frontend stores nothing.

**Agent Design**

The agent runs on Claude Sonnet with tool use enabled. Constraints prevent runaway behaviour: maximum 20 conversation turns, maximum 10 Stedi API calls, and a 10-minute hard timeout. Extended thinking is enabled for complex reasoning about payer mappings and discrepancy analysis.

Five tools are available to the agent:

- `lookup_npi` / `search_npi`: Validate and search the NPPES registry
- `search_payers`: Query Stedi's payer directory
- `discover_insurance`: Stedi's insurance discovery for unknown payers (slow, used as fallback)
- `check_eligibility`: Submit the actual X12 270/271 transaction

Results are cached in Upstash Redis. NPI lookups persist for one hour, significantly reducing external API calls for repeat provider searches.

**HIPAA Compliance**

Every database query filters by tenant identifier derived from the FHIR issuer URL. There are no exceptions. Audit logging captures all PHI access using fire-and-forget writes that never block the request path. Logs contain resource identifiers, never actual patient data.

**The Practice Fusion Quirk**

A word of caution for anyone integrating with Practice Fusion's FHIR API: the member ID is not in `Coverage.subscriberId`. That field contains garbage data (`\S\0\S\AT`). The actual member ID lives in a custom extension: `Coverage.extension[url*="coverage-insured-unique-id"].valueString`. We discovered this the hard way.

## Scaling to Production

The current proof-of-concept handles roughly 5-10 queries per second, constrained primarily by agent execution time (30-60 seconds typical) and Fly.io's connection limits. Scaling to 1000 QPS requires architectural changes rather than simply adding instances.

**Async Processing**

The synchronous SSE model works for a POC but cannot scale. Production deployment moves agent execution to a dedicated worker tier with Bull.js or Temporal managing the job queue. The API returns a job identifier immediately; clients poll for results or subscribe to webhook notifications.

**Infrastructure**

Target architecture: 12 API instances handling request routing and validation, 20 worker instances executing agent runs, PostgreSQL with read replicas, and Upstash Redis Pro for cache and job coordination. Multi-region deployment across US East and West provides high availability.

**Aggressive Caching**

Cache coverage expands significantly: FHIR patient and coverage data (5-minute TTL), payer search results (24 hours), insurance discovery results (1 hour, keyed by demographics hash). With proper caching, repeat eligibility checks for the same patient and insurance return immediately without invoking the agent.

## Cost Reality

The POC runs on approximately $27 per month: shared Fly.io instances, free Redis tier, and roughly 100 agent runs monthly.

At 1000 QPS (approximately 2.6 million runs monthly), costs scale to roughly $43,000 per month. Anthropic API costs dominate at $39,000, with infrastructure comprising the remainder.

Cost mitigation strategies:

- **Result caching**: Same patient, same insurance, same day equals same result. Cache aggressively.
- **Model tiering**: Use Claude Haiku for straightforward cases (known payer mappings, simple validations). Reserve Sonnet for complex reasoning.
- **Volume pricing**: Enterprise agreements with Anthropic and Stedi significantly reduce per-transaction costs.

The unit economics work when eligibility checks replace manual staff time. A check that takes 10 minutes manually and costs $0.02 via the agent is compelling even before considering error reduction.

## AI Governance and Evaluation

Healthcare AI demands rigorous evaluation. We track three risk categories:

**Hallucination**: The agent might generate a plausible but incorrect payer identifier. Mitigation: every payer ID is validated against Stedi's directory before submission.

**Misinterpretation**: Complex 271 responses with multiple service types and coverage levels could be parsed incorrectly. Mitigation: structured output schemas with required fields, source attribution linking claims to specific response segments.

**Prompt Injection**: Malicious data in FHIR resources could attempt to manipulate agent behaviour. Mitigation: input sanitisation before agent context, output validation against expected schemas.

**Evaluation Framework**

The test suite comprises 170 cases: 100 golden cases with known correct answers, 50 edge cases (multiple insurances, subscriber vs dependent, name mismatches), and 20 adversarial cases testing prompt injection resistance.

Deployment gates require >98% accuracy on golden cases, <1% hallucination rate, and P99 latency under 60 seconds. Any regression blocks deployment automatically.

**Safe Degradation**

When confidence is low or external services fail, the system degrades gracefully:

- Stedi unavailable: Return cached eligibility (if recent) with a STALE indicator
- Agent uncertain: Flag for human review rather than returning potentially incorrect data
- Rate limited: Queue for retry rather than failing immediately

Human escalation paths exist for cases the agent cannot resolve confidently. These are exceptions, not the norm, but they prevent the system from confidently returning incorrect information.

## Lessons Learned

Building AI agents for healthcare taught us several things:

**Fail loudly**. Silent fallbacks that return default values create subtle, dangerous bugs. When the NPPES API fails, the system throws an error. When a required field is missing, the agent reports it explicitly rather than inferring.

**Tenant isolation is non-negotiable**. Every query, every cache key, every log entry includes tenant context. There are no shortcuts.

**Observability matters more than you think**. Streaming the agent's reasoning to the UI transformed user trust. Staff understand why the system made specific decisions, can identify errors, and provide feedback that improves the system.

**The messy middle is where value lives**. Deterministic code handles the easy 80%. The agent handles the ambiguous 20% that previously required human judgement. That 20% is where the operational cost actually accumulates.

The Eligibility Agent is now handling production traffic for a limited pilot group. Early results suggest a 70% reduction in time spent on eligibility verification and a measurable decrease in claim denials related to eligibility errors. Whether those numbers hold at scale remains to be seen, but the architecture is ready to find out.
