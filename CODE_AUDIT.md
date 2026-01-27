# Code Audit Report

**Date:** January 26, 2026
**Codebase:** EligibilityAgent (SMART on FHIR Healthcare Eligibility Verification)
**Status:** Production-deployed on Fly.io
**Last Updated:** January 26, 2026 (Post-Refactor Security Review)

---

## Executive Summary

This audit covers test coverage, code quality, performance, security/privacy, cost effectiveness, logging/monitoring, and dependency management. **The Architecture Overhaul (Phases 1-4) introduced several new bugs and failed to address pre-existing security issues.**

| Category | Status | Critical Issues |
|----------|--------|-----------------|
| Test Coverage | **HIGH** | Framework configured, partial tests |
| Code Quality | **LOW** | Console.log removed, ESLint configured |
| Performance | **LOW** | Redis caching implemented |
| Security/Privacy | **CRITICAL** | Multiple SSRF vectors, auth issues |
| Cost Effectiveness | **MEDIUM** | Redis caching, no API throttling |
| Logging/Monitoring | **MEDIUM** | Structured logging, security events at DEBUG |
| Dependencies | **LOW** | 2 unused packages |

---

## CRITICAL SECURITY ISSUES

### Issue #1: OAuth State Store is In-Memory (WILL BREAK MULTI-INSTANCE)

**Location:** `apps/api/src/routes/auth.ts:51-52`
**Status:** 🔴 PRE-EXISTING, NEVER FIXED
**Impact:** OAuth fails when Fly.io routes /launch and /callback to different instances

```typescript
// In-memory state store (use Redis in production for multi-instance)
const stateStore = new Map<string, LaunchState>();
```

**The comment acknowledges this is wrong but it was never fixed.**

**Fix Required:**
```typescript
// Use Redis instead of Map
import { cacheGet, cacheSet, cacheDelete } from '../lib/redis.js';
```

---

### Issue #2: SSRF in OAuth Discovery (NO DOMAIN VALIDATION)

**Location:** `apps/api/src/routes/auth.ts:58-122`
**Status:** 🔴 PRE-EXISTING, NEVER IDENTIFIED
**Impact:** Attacker can probe internal services, create malicious tenants

The `/auth/launch` endpoint accepts an `iss` parameter and makes HTTP requests to it without any domain validation. Unlike FHIR routes which have `isAllowedFhirUrl()`, auth discovery has NO protection.

**Attack:**
```
GET /auth/launch?iss=http://internal-metadata-service&launch=xyz
GET /auth/launch?iss=http://169.254.169.254/latest/meta-data&launch=xyz
```

**Fix Required:** Add domain whitelist validation before `discoverSmartConfiguration()`.

---

### Issue #3: Token Refresh SSRF (PF CREDENTIALS EXFILTRATION)

**Location:** `apps/api/src/services/session-service.ts:315-369`
**Status:** 🔴 PRE-EXISTING, NEVER IDENTIFIED
**Impact:** Attacker can steal PF refresh tokens

If a malicious tenant is created via Issue #2, the `refreshPfToken()` function will POST the user's refresh token to the attacker's server when discovering the token endpoint.

**Fix Required:** Validate `fhirBaseUrl` against domain whitelist in `refreshPfToken()`.

---

### Issue #4: Database Errors Not Caught in OAuth Callback

**Location:** `apps/api/src/routes/auth.ts:377-389`
**Status:** 🔴 INTRODUCED IN PHASE 2
**Impact:** Any Prisma error crashes the callback, user sees 500

```typescript
// These lines are OUTSIDE the try/catch block!
const tenant = await getOrCreateTenant(launchState.iss, tokenData.access_token);
const { sessionId, internalJwt, expiresAt } = await createSession({...});
```

**Fix Required:** Wrap in try/catch with proper error response.

---

### Issue #5: Session Token Returned in Response Body

**Location:** `apps/api/src/routes/auth.ts:431`
**Status:** 🟠 INTRODUCED IN PHASE 2 (workaround)
**Impact:** Token visible in DevTools, logs, defeats httpOnly protection

```typescript
return {
  success: true,
  _sessionToken: internalJwt,  // Token exposed in response body!
  _cookieOptions: cookieOptions,
};
```

**Why it exists:** Workaround for Next.js cookie forwarding issues.
**Fix Required:** Fix cookie forwarding properly, remove token from body.

---

### Issue #6: JWT Tampering Logged at DEBUG Level

**Location:** `apps/api/src/services/session-service.ts:298-306`, `apps/api/src/middleware/session.ts:88-93`
**Status:** 🟠 INTRODUCED IN PHASE 2
**Impact:** Security events invisible in production logs

```typescript
} catch (error) {
  serviceLogger.debug({ error }, 'JWT verification failed');  // Should be WARN!
}
```

**Fix Required:** Change to `serviceLogger.warn()` for security events.

---

### Issue #7: Redis Errors Crash Logout/Refresh

**Location:** `apps/api/src/services/session-service.ts:228, 277`
**Status:** 🟠 INTRODUCED IN PHASE 2
**Impact:** Can't logout if Redis is temporarily unavailable

```typescript
await cacheDelete(CacheKeys.session(session.internalJwtId));  // Throws on Redis error
```

**Fix Required:** Add try/catch, proceed with database operation even if cache fails.

---

### Issue #8: Concurrent Session Refresh Race Condition

**Location:** `apps/api/src/services/session-service.ts:216-260`
**Status:** 🟠 INTRODUCED IN PHASE 2
**Impact:** Random logouts under concurrent load

Two requests with same expiring JWT both call `refreshSession()`, both sign new JWTs, both update database. Loser's token becomes invalid.

**Fix Required:** Add distributed lock using Redis SETNX.

---

### Issue #9: Race Condition in Tenant Creation

**Location:** `apps/api/src/routes/auth.ts:129-178`
**Status:** 🔴 PRE-EXISTING
**Impact:** Concurrent OAuth flows with same issuer cause 500 errors

```typescript
let tenant = await prisma.tenant.findUnique({ where: { issuer } });
if (!tenant) {
  tenant = await prisma.tenant.create({ data: { issuer, ... } });  // Race!
}
```

**Fix Required:** Use `upsert` or handle unique constraint violation.

---

### Issue #10: FHIR Resource ID Injection

**Location:** `apps/api/src/routes/fhir.ts:384-452`
**Status:** 🟡 PRE-EXISTING
**Impact:** Path traversal possible

```typescript
const response = await axios.get(`${fhirBaseUrl}/${resourceType}/${resourceId}`);
```

No validation that `resourceType` and `resourceId` don't contain `../` or special characters.

**Fix Required:** Validate parameters are alphanumeric only.

---

### Issue #11: Double Error Events from Agent

**Location:** `apps/api/src/services/agent/loop.ts:385-410`
**Status:** 🟡 INTRODUCED IN PHASE 3
**Impact:** UI shows error hiding successful result

If `updateAgentRun('completed', ...)` throws after yielding complete event, catch block yields error event too.

**Fix Required:** Wrap database update in separate try/catch.

---

### Issue #12: JWT Placeholder Creates Race Window

**Location:** `apps/api/src/services/session-service.ts:56-88`
**Status:** 🟡 INTRODUCED IN PHASE 2
**Impact:** Brief window where session lookup fails

Session created with `internalJwtId: 'pending'`, then updated. If cache TTL expires before update, lookup fails.

**Fix Required:** Use transaction or single create with correct JTI.

---

## Issues Fixed During This Review

| Issue | Location | Fix |
|-------|----------|-----|
| SSE route missing `{ sse: true }` | `agent.ts:87` | Added route option |
| @fastify/sse not registered | `index.ts:49` | Added plugin registration |
| Accept header not forwarded in proxy | `proxy.ts:134` | Added header forwarding |
| Invalid URL in token refresh | `session-service.ts:368` | Added URL validation |

---

## Architecture Overhaul Progress

### Completed Phases (1-4)

| Phase | Description | Status | Issues Introduced |
|-------|-------------|--------|-------------------|
| 1 | Database Schema & Foundation | ✅ Complete | 0 |
| 2 | Internal JWT & Cookie Auth | ✅ Complete | 6 (Issues #4-8, #12) |
| 3 | Audit Logging & Agent Output Storage | ✅ Complete | 1 (Issue #11) |
| 4 | Remove Payer Memory & Redis Caching | ✅ Complete | 0 |

### Remaining Phases (5-7)

| Phase | Description | Status |
|-------|-------------|--------|
| 5 | Testing & Playwright E2E | Pending |
| 6 | Code Quality & Type Safety | Pending |
| 7 | Monitoring, Alerting & Fly.io Integration | Pending |

---

## 1. Test Coverage

### Current Status: PARTIAL COVERAGE

- [x] **Jest configured** - `apps/api/jest.config.js` with ESM support
- [x] **Test files exist** - encryption.test.ts (14 tests), npi.test.ts (22 tests)
- [x] **CI test stage** - GitHub Actions runs tests before deployment
- [ ] **Coverage thresholds** - No minimum coverage requirements

### Critical Modules Test Status

| Module | Status | Notes |
|--------|--------|-------|
| `lib/encryption.ts` | ✅ TESTED | 14 tests |
| `services/npi.ts` | ✅ TESTED | 22 Luhn tests |
| `lib/jwt.ts` | ❌ NOT TESTED | New in Phase 2 |
| `services/session-service.ts` | ❌ NOT TESTED | New in Phase 2, 6 bugs |
| `services/audit-service.ts` | ❌ NOT TESTED | New in Phase 3 |
| `services/stedi.ts` | ❌ NOT TESTED | X12 parsing |
| `services/agent/loop.ts` | ❌ NOT TESTED | Agent reasoning |
| `routes/auth.ts` | ❌ NOT TESTED | OAuth flow, 4 bugs |

---

## 2. Code Quality

### Console.log Statements

> **STATUS: ADDRESSED**
>
> - ✅ **Backend**: All services use `serviceLogger` from `lib/logger.ts`
> - ✅ **Frontend**: All console.log/error removed from components

### SessionStorage Usage

> **STATUS: ADDRESSED**
>
> - ✅ Frontend uses `credentials: 'include'` for cookie auth
> - ✅ sessionStorage no longer used for tokens

### Type Safety Issues

> **STATUS: NOT ADDRESSED (Phase 6)**
>
> - ❌ `fhir.ts:229` - `(coverageResource as { extension?: unknown[] })`
> - ❌ `agent.ts:173` - `(event.result as { success?: boolean })?.success`
> - ❌ `npi.ts` - `any` in response mapping
> - ❌ `stedi.ts:54` - `parseStediResponse(response: any)`

---

## 3. Performance

### Database Optimization

> **STATUS: ADDRESSED**
>
> - ✅ New schema with proper indexes on all tables
> - ✅ Encryption key derivation cached

### Caching

> **STATUS: ADDRESSED**
>
> - ✅ **NPI lookups**: Redis cache with 1-hour TTL
> - ✅ **SMART configuration**: Redis cache with 1-hour TTL
> - ✅ **Sessions**: Redis cache with 15-minute TTL

---

## 4. Security & Privacy

### PHI Logging

> **STATUS: ADDRESSED**
>
> - ✅ All services use `serviceLogger` with automatic PHI redaction

### Route Authorization

> **STATUS: PARTIALLY ADDRESSED**
>
> - ✅ Session middleware registered on protected routes
> - ❌ Auth routes have NO rate limiting
> - ❌ Auth routes have NO domain validation (SSRF)

### Audit Trail

> **STATUS: ADDRESSED**
>
> - ✅ AuditLog table in schema with proper indexes
> - ✅ Fire-and-forget pattern implemented

### Cookie-Based Auth

> **STATUS: BROKEN**
>
> - ✅ @fastify/cookie registered
> - ❌ Token returned in response body (defeats httpOnly)
> - ❌ State store is in-memory (breaks multi-instance)

---

## 5. Issues That Will Impact End-to-End Testing

### Will Likely Work (Single Instance, Happy Path)

| Component | Status | Notes |
|-----------|--------|-------|
| OAuth launch/callback | ⚠️ Should work | Single instance, state store OK |
| Session creation | ⚠️ Should work | If DB is healthy |
| FHIR data fetch | ✅ Should work | Cookie auth implemented |
| SSE streaming | ✅ Should work | Just fixed `{ sse: true }` |
| Agent execution | ✅ Should work | If Anthropic API key valid |

### May Break During Testing

| Issue | When It Breaks | Workaround |
|-------|----------------|------------|
| In-memory state store | If Fly.io routes to different instance | Scale to 1 instance for testing |
| Redis errors | If Upstash has latency spike | Monitor Redis health |
| DB errors in callback | If Prisma connection fails | Check DATABASE_URL |

### Will NOT Impact Testing (Security Issues)

- SSRF vulnerabilities (need attacker)
- Race conditions (need concurrent users)
- JWT tampering logging (functionality works)

---

## 6. Priority Fix Order

### P0 - Fix Before Production Traffic

1. Move state store to Redis (Issue #1)
2. Add domain validation to OAuth discovery (Issue #2)
3. Wrap DB calls in try/catch in callback (Issue #4)
4. Add domain validation to token refresh (Issue #3)

### P1 - Fix Before Scale

5. Add distributed lock for session refresh (Issue #8)
6. Handle tenant creation race (Issue #9)
7. Fix Redis error handling (Issue #7)

### P2 - Fix for Security Hardening

8. Remove token from response body (Issue #5)
9. Change JWT errors to WARN level (Issue #6)
10. Validate FHIR resource IDs (Issue #10)

### P3 - Fix for Reliability

11. Fix double error events (Issue #11)
12. Fix JWT placeholder race (Issue #12)

---

## 7. Summary

### Issues by Source

| Source | Count | Examples |
|--------|-------|----------|
| Pre-existing (never identified) | 5 | SSRF, state store, tenant race |
| Introduced in Phase 2 | 6 | Token in body, JWT races |
| Introduced in Phase 3 | 1 | Double error events |
| Fixed today | 4 | SSE route, plugin registration |

### Honest Assessment

The CODE_AUDIT.md previously gave false confidence by checking "feature implemented" boxes without verifying security or correctness. The Phase 1-4 refactor:

1. **Did improve**: Structured logging, audit trail, Redis caching, session middleware
2. **Did NOT fix**: Pre-existing SSRF, state store, race conditions
3. **Introduced**: 7 new bugs in auth and agent flows

### For End-to-End Testing

**The SSE fix just deployed should allow testing.** The remaining issues are:
- Security vulnerabilities (won't block functional testing)
- Race conditions (won't hit with single user)
- Error handling gaps (may see occasional 500s)

---

*Generated by Claude Code Audit - January 26, 2026*
*Post-Refactor Security Review Complete*
*12 Critical/High Issues Identified*
