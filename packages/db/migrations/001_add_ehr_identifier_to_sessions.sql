-- Migration: Add EHR Identifier to Sessions
-- Date: 2026-02-11
-- Purpose: Support multiple EHR OAuth credentials by storing EHR identifier in session
--
-- This migration adds the ehrIdentifier column to the sessions table, which is used
-- to determine which OAuth credentials to use when refreshing access tokens.
--
-- DEPLOYMENT STEPS:
-- 1. Apply schema migration (add column)
-- 2. Apply data migration (set existing sessions to 'PF')
-- 3. Deploy code changes that require ehrIdentifier

-- ============================================================================
-- STEP 1: Schema Migration - Add ehrIdentifier column (nullable)
-- ============================================================================

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS ehr_identifier VARCHAR(50);

COMMENT ON COLUMN sessions.ehr_identifier IS 'EHR system identifier (e.g., PF, VERADIGM) used to select OAuth credentials for token refresh';

-- ============================================================================
-- STEP 2: Data Migration - Set existing sessions to Practice Fusion
-- ============================================================================
--
-- IMPORTANT: This migration assumes all existing sessions are Practice Fusion sessions.
-- Only update active (non-revoked) sessions, as revoked sessions won't be used for refresh.

UPDATE sessions
SET ehr_identifier = 'PF'
WHERE ehr_identifier IS NULL AND revoked = false;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify all active sessions have ehrIdentifier
SELECT COUNT(*) as sessions_without_ehr_identifier
FROM sessions
WHERE ehr_identifier IS NULL AND revoked = false;
-- Expected: 0

-- Count sessions by EHR
SELECT
  ehr_identifier,
  COUNT(*) as session_count,
  COUNT(*) FILTER (WHERE revoked = false) as active_sessions,
  COUNT(*) FILTER (WHERE revoked = true) as revoked_sessions
FROM sessions
GROUP BY ehr_identifier
ORDER BY ehr_identifier;
