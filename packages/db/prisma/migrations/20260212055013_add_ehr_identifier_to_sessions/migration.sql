-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "ehr_identifier" TEXT;

-- Data Migration: Set existing sessions to use Practice Fusion (PF) credentials
-- This is a ONE-TIME migration to ensure all existing active sessions have an ehrIdentifier
-- After this migration, the code will always set ehrIdentifier for new sessions
UPDATE "sessions"
SET "ehr_identifier" = 'PF'
WHERE "ehr_identifier" IS NULL AND "revoked" = false;
