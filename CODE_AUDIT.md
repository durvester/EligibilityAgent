# Code Audit Report

**Date:** January 26, 2026
**Codebase:** EligibilityAgent (SMART on FHIR Healthcare Eligibility Verification)
**Status:** Production-deployed on Fly.io
**Last Updated:** January 26, 2026 (Architecture Overhaul Phases 1-4 Complete)

---

## Executive Summary

This audit covers test coverage, code quality, performance, security/privacy, cost effectiveness, logging/monitoring, and dependency management. **Significant progress has been made** with the Architecture Overhaul (Phases 1-4), addressing many critical security and compliance gaps.

| Category | Status | Critical Issues |
|----------|--------|-----------------|
| Test Coverage | **HIGH** | Framework configured, partial tests |
| Code Quality | **LOW** | Console.log removed, ESLint configured |
| Performance | **LOW** | Redis caching, key caching implemented |
| Security/Privacy | **MEDIUM** | Auth middleware active, audit logging implemented, cookies in progress |
| Cost Effectiveness | **MEDIUM** | Redis caching, no API throttling |
| Logging/Monitoring | **MEDIUM** | Structured logging, no external monitoring |
| Dependencies | **LOW** | 2 unused packages, env validation done |

---

## Architecture Overhaul Progress

### Completed Phases (1-4)

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Database Schema & Foundation | ✅ Complete |
| 2 | Internal JWT & Cookie Auth | ✅ Complete |
| 3 | Audit Logging & Agent Output Storage | ✅ Complete |
| 4 | Remove Payer Memory & Redis Caching | ✅ Complete |

### Remaining Phases (5-7)

| Phase | Description | Status |
|-------|-------------|--------|
| 5 | Testing & Playwright E2E | Pending |
| 6 | Code Quality & Type Safety | Pending |
| 7 | Monitoring, Alerting & Fly.io Integration | Pending |

### Key Architecture Changes

1. **Tenant-Centric Model**: `issuer` (FHIR base URL) = Practice = Tenant
2. **Two-Token Auth**: Internal JWTs for API, PF OAuth tokens only for FHIR
3. **Cookie-Based Sessions**: HTTP-only cookies replace sessionStorage
4. **Upstash Redis**: Required caching layer (no fallback)
5. **Fire-and-Forget Audit**: HIPAA-compliant audit logging
6. **AgentRun Persistence**: Final outputs stored, streaming in-memory

---

## 1. Test Coverage

### Current Status: PARTIAL COVERAGE

- [x] **Jest configured** - `apps/api/jest.config.js` with ESM support
- [x] **Test files exist** - encryption.test.ts (14 tests), npi.test.ts (22 tests)
- [x] **CI test stage** - GitHub Actions runs tests before deployment
- [ ] **Coverage thresholds** - No minimum coverage requirements

> **REMEDIATION STATUS: PARTIALLY ADDRESSED**
>
> - ✅ Jest installed and configured
> - ✅ Encryption tests: roundtrip, uniqueness, tamper detection
> - ✅ NPI Luhn validation tests
> - ✅ CI blocks deployment on test failure
> - ❌ Coverage thresholds NOT configured
> - ❌ Session/auth tests NOT written
> - ❌ Stedi parsing tests NOT written
> - ❌ Playwright E2E NOT configured

### Critical Modules Test Status

| Module | Status | Notes |
|--------|--------|-------|
| `lib/encryption.ts` | ✅ TESTED | 14 tests |
| `services/npi.ts` | ✅ TESTED | 22 Luhn tests |
| `lib/jwt.ts` | ❌ NOT TESTED | New in Phase 2 |
| `services/session-service.ts` | ❌ NOT TESTED | New in Phase 2 |
| `services/audit-service.ts` | ❌ NOT TESTED | New in Phase 3 |
| `services/stedi.ts` | ❌ NOT TESTED | X12 parsing |
| `services/agent/loop.ts` | ❌ NOT TESTED | Agent reasoning |

### Priority for Phase 5

| Priority | Test | Status |
|----------|------|--------|
| P0 | JWT sign/verify tests | Pending |
| P1 | Session service tests | Pending |
| P2 | Audit service tests | Pending |
| P3 | Stedi X12 parsing tests | Pending |
| P4 | OAuth flow E2E tests | Pending |

---

## 2. Code Quality

### Console.log Statements

> **REMEDIATION STATUS: FULLY ADDRESSED**
>
> - ✅ **Backend**: All services use `serviceLogger` from `lib/logger.ts`
> - ✅ **Frontend**: All console.log/error removed from components
> - ✅ Remaining console usage only in:
>   - `lib/logger.ts` (the logger itself)
>   - `lib/validate-env.ts` (startup errors, acceptable)

### SessionStorage Usage

> **REMEDIATION STATUS: FULLY ADDRESSED**
>
> - ✅ **Callback page**: No longer stores tokens in sessionStorage
> - ✅ **Eligibility page**: Uses `credentials: 'include'` for cookie auth
> - ✅ **ProviderInfo**: Uses cookie auth
> - ✅ **SSE client**: Supports credentials option
> - ✅ Frontend only mentions sessionStorage in comments explaining it's removed

### Hardcoded Values

| Location | Issue | Status |
|----------|-------|--------|
| `routes/auth.ts` | localhost callback fallback | ⚠️ Still exists for dev |
| `lib/encryption.ts` | dev fallback key | ✅ Throws in production |
| `services/stedi.ts` | 'Healthcare Provider' fallback | ⚠️ Acceptable last resort |

### Type Safety Issues

> **REMEDIATION STATUS: NOT ADDRESSED (Phase 6)**
>
> - ❌ `fhir.ts:229` - `(coverageResource as { extension?: unknown[] })`
> - ❌ `agent.ts:170` - `(event.result as any)?.success`
> - ❌ `npi.ts` - `any` in response mapping
> - ❌ `stedi.ts:54` - `parseStediResponse(response: any)`

### ESLint Configuration

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ `.eslintrc.json` created with TypeScript rules
> - ✅ `no-console: "warn"` configured
> - ✅ `@typescript-eslint/no-explicit-any: "warn"` configured
> - ❌ Lint check NOT added to CI pipeline (Phase 6)

---

## 3. Performance

### Database Optimization

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ New schema with proper indexes on all tables:
>   - `sessions`: indexes on `internalJwtId`, `tenantId+userFhirId`, `tenantId+patientId`
>   - `agent_runs`: indexes on `tenantId+startedAt`, `tenantId+patientFhirId`
>   - `audit_logs`: indexes on `tenantId+createdAt`, `tenantId+patientFhirId`, `sessionId`

### Blocking Operations

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ Encryption key derivation cached (scryptSync called once per server lifetime)
> - ✅ Redis operations are async

### Caching

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ **NPI lookups**: Redis cache with 1-hour TTL
> - ✅ **SMART configuration**: In-memory cache with 1-hour TTL
> - ✅ **Sessions**: Redis cache with 15-minute TTL
> - ✅ **Payer mappings**: REMOVED (agent uses search_payers)
> - ❌ Old in-memory LRU cache deleted, replaced with Redis

### Timeouts

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ Agent timeout: 10-minute hard limit
> - ✅ Payer search: 15s timeout
> - ✅ FHIR requests: 15s timeout

---

## 4. Security & Privacy

### PHI Logging

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ All services use `serviceLogger` with automatic PHI redaction
> - ✅ Names masked: `"John"` → `"J***"`
> - ✅ Member IDs masked: `"ABC123456789"` → `"****6789"`
> - ✅ DOBs masked: `"1990-05-15"` → `"[REDACTED]"`
> - ✅ SSNs, addresses, phone numbers, emails all redacted

### Route Authorization

> **REMEDIATION STATUS: FULLY ADDRESSED**
>
> - ✅ **Session middleware registered** on all protected routes (`index.ts:80-81, 96-97`)
> - ✅ **Protected routes**: `/fhir/*`, `/eligibility/*`, `/history/*`, `/agent/*`
> - ✅ **Public routes**: `/auth/*`, `/npi/*`, `/health`
> - ✅ **Agent endpoints**: Additional rate limit (10/min)

### Audit Trail

> **REMEDIATION STATUS: FULLY ADDRESSED**
>
> - ✅ **AuditLog table** in schema with proper indexes
> - ✅ **Audit service** (`services/audit-service.ts`) implements fire-and-forget pattern
> - ✅ **Login/logout** audited in auth routes
> - ✅ **Convenience functions**: `auditViewPatient`, `auditEligibilityCheck`, `auditViewResults`, `auditError`
> - ✅ **HIPAA compliance**: Never blocks requests, logs to DB with stdout fallback

### Rate Limiting

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ Global: 100 requests/minute per IP
> - ✅ Agent: 10 requests/minute per IP (stricter)
> - ✅ Health check excluded from rate limiting

### Cookie-Based Auth

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ **@fastify/cookie** registered
> - ✅ **Internal JWT** stored in HTTP-only cookie
> - ✅ **Frontend** uses `credentials: 'include'`
> - ✅ **sessionStorage** no longer used for tokens
> - ⚠️ **Testing required** to verify cookie flow works end-to-end

### JWT Verification

> **REMEDIATION STATUS: PARTIALLY ADDRESSED**
>
> - ✅ **Internal JWTs** verified with jose library (`lib/jwt.ts`)
> - ❌ **PF ID tokens** still only decoded, not cryptographically verified

### FHIR URL Validation

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ Allowlist-based validation (`ALLOWED_FHIR_DOMAINS`)
> - ✅ HTTPS required in production

### Other Security

| Item | Status |
|------|--------|
| CORS credentials | ✅ Enabled |
| HSTS header | ✅ In production |
| Request size limit | ✅ 10MB |
| CSRF (state param) | ✅ Validated |

---

## 5. Cost Effectiveness

### API Call Optimization

| Item | Status |
|------|--------|
| NPI caching | ✅ Redis 1-hour TTL |
| SMART config caching | ✅ In-memory 1-hour TTL |
| Stedi API throttling | ❌ NOT ADDRESSED |
| Payer mappings | ✅ REMOVED (simplification) |

### Token Usage

- ❌ No token budget tracking or alerts

### Resource Usage

- ❌ No auto-scaling configured in Fly.io

---

## 6. Logging & Monitoring

### Logging Infrastructure

> **REMEDIATION STATUS: PARTIALLY ADDRESSED**
>
> - ✅ **Structured JSON logging** via `serviceLogger`
> - ✅ **PHI-safe** with automatic redaction
> - ⚠️ **Request ID** not systematically added to all logs
> - ❌ **Log aggregation** NOT configured (Phase 7)

### Health Checks

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ **Health route** (`/health`) with DB and Redis status
> - ✅ **Latency reporting** for both services
> - ❌ **Dashboard** NOT configured (Phase 7)

### Monitoring

> **REMEDIATION STATUS: NOT ADDRESSED (Phase 7)**
>
> - ❌ No Grafana/Prometheus integration
> - ❌ No alerting configured
> - ❌ No metrics collection

---

## 7. Dependencies Management

### Unused Dependencies

- ❌ `pdfkit` still in dependencies
- ❌ `@types/pdfkit` still in devDependencies

### New Dependencies Added

| Package | Purpose |
|---------|---------|
| `jose` | Internal JWT signing/verification |
| `@upstash/redis` | Redis caching (required) |
| `@fastify/cookie` | Cookie support for sessions |

### Environment Validation

> **REMEDIATION STATUS: ADDRESSED**
>
> - ✅ `lib/validate-env.ts` validates at startup
> - ✅ Fails fast on missing required vars
> - ✅ New required vars: `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`, `JWT_SECRET`

### Files Deleted

| File | Reason |
|------|--------|
| `services/payer-mapping.ts` | Payer memory removed |
| `services/token-service.ts` | Replaced by session-service |
| `lib/cache.ts` | Replaced by Redis |

---

## 8. Compliance Checklist

### HIPAA Requirements

| Requirement | Status |
|-------------|--------|
| Access controls | ✅ Session middleware on all PHI routes |
| Audit trail | ✅ AuditLog with fire-and-forget writes |
| PHI protection | ✅ Logs redact all PHI |
| Encryption at rest | ✅ Tokens encrypted with AES-256-GCM |
| Encryption in transit | ✅ HSTS header, HTTPS enforced |
| Data retention | ⚠️ Cleanup function exists, not scheduled |
| BAA documentation | ❌ NOT ADDRESSED |

### Security Best Practices

| Practice | Status |
|----------|--------|
| Input validation | ✅ Body size limit, URL validation |
| Rate limiting | ✅ Global + agent-specific |
| JWT verification | ✅ Internal JWTs verified |
| CSRF protection | ✅ State parameter validated |
| XSS prevention | ✅ Tokens in HTTP-only cookies |

---

## 9. Action Items by Priority

### Completed (Phases 1-4)

| Item | Category | Status |
|------|----------|--------|
| Remove PHI from logs | Security | ✅ DONE |
| Add route authorization | Security | ✅ DONE |
| Implement audit logging | Compliance | ✅ DONE |
| Add rate limiting | Security | ✅ DONE |
| Move tokens to cookies | Security | ✅ DONE |
| Add Redis caching | Performance | ✅ DONE |
| Add database indexes | Performance | ✅ DONE |
| Add env validation | Quality | ✅ DONE |
| Remove console.log | Quality | ✅ DONE |
| Add ESLint config | Quality | ✅ DONE |
| Fix blocking crypto | Performance | ✅ DONE |

### Phase 5 - Testing & Playwright E2E

| Item | Category | Effort |
|------|----------|--------|
| JWT sign/verify tests | Testing | 2 hours |
| Session service tests | Testing | 3 hours |
| Audit service tests | Testing | 2 hours |
| Stedi X12 parsing tests | Testing | 3 hours |
| Playwright setup | Testing | 2 hours |
| OAuth flow E2E tests | Testing | 4 hours |
| SSE streaming E2E tests | Testing | 3 hours |
| Coverage thresholds | Testing | 1 hour |

### Phase 6 - Code Quality & Type Safety

| Item | Category | Effort |
|------|----------|--------|
| Fix all `any` types | Quality | 4 hours |
| Add lint check to CI | Quality | 1 hour |
| Remove unused dependencies | Dependencies | 1 hour |
| Create typed interfaces for APIs | Quality | 3 hours |

### Phase 7 - Monitoring, Alerting & Fly.io Integration

| Item | Category | Effort |
|------|----------|--------|
| Configure Fly.io metrics | Monitoring | 2 hours |
| Set up log drain to Grafana | Monitoring | 3 hours |
| Configure alerts | Monitoring | 2 hours |
| Add request ID to all logs | Logging | 2 hours |
| Token usage tracking | Cost | 3 hours |

---

## 10. Summary

### Progress Overview

| Category | Before | After | Change |
|----------|--------|-------|--------|
| Test Coverage | 0 tests | 36 tests | +36 |
| Console.log | 25+ | 0 (app code) | -25 |
| Security Critical | 5 issues | 1 issue | -4 |
| Auth Protected Routes | 0 | 4 scopes | +4 |
| Audit Logging | None | Full | New |
| Caching | In-memory | Redis | Upgraded |

### Remaining Critical Items

1. **PF ID token verification** - Not cryptographically verified against JWKS
2. **Test coverage gaps** - Session, audit, and Stedi services untested
3. **Monitoring** - No external monitoring or alerting

### Files Created (Phases 1-4)

```
apps/api/src/lib/jwt.ts
apps/api/src/lib/redis.ts
apps/api/src/services/session-service.ts
apps/api/src/services/audit-service.ts
apps/api/src/middleware/session.ts
apps/api/src/routes/health.ts
apps/api/src/routes/history.ts
.claude/rules/auth-patterns.md
.claude/rules/tenant-architecture.md
.claude/rules/no-fallbacks.md
.claude/rules/audit-logging.md
```

### Files Modified (Phases 1-4)

```
packages/db/prisma/schema.prisma (new tenant-centric schema)
apps/api/src/index.ts (middleware registration, cookie plugin)
apps/api/src/routes/auth.ts (cookie auth, tenant creation)
apps/api/src/routes/fhir.ts (session-based PF tokens)
apps/api/src/routes/agent.ts (context for persistence)
apps/api/src/services/agent/loop.ts (AgentRun persistence)
apps/api/src/services/agent/executor.ts (removed payer mapping)
apps/api/src/services/agent/tools.ts (removed payer mapping)
apps/api/src/services/npi.ts (Redis caching)
apps/web/src/app/callback/page.tsx (cookie auth)
apps/web/src/app/eligibility/page.tsx (credentials: include)
apps/web/src/app/eligibility/components/ProviderInfo.tsx (cookie auth)
apps/web/src/app/eligibility/components/InsuranceForm.tsx (removed console)
apps/web/src/lib/sse-client.ts (credentials support, removed console)
```

### Files Deleted (Phases 1-4)

```
apps/api/src/services/payer-mapping.ts
apps/api/src/services/token-service.ts
apps/api/src/lib/cache.ts
```

### Database Schema Changes

The new schema requires `pnpm db:push` against the database:

- **New tables**: `tenants`, `sessions`, `agent_runs`, `audit_logs`
- **Changed**: `Tenant.issuer` replaces `Tenant.fhirBaseUrl` as unique key
- **Removed**: `OAuthToken` table (replaced by `Session`)
- **Removed**: `PayerMapping` table (payer memory eliminated)

---

*Generated by Claude Code Audit - January 2026*
*Architecture Overhaul Phases 1-4 Complete*
*Phases 5-7 Pending*
