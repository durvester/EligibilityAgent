/**
 * Audit Service (HIPAA Compliant)
 *
 * Fire-and-forget audit logging - NEVER blocks requests.
 *
 * Every PHI access MUST be logged:
 * - login / logout
 * - view_patient / view_coverage
 * - check_eligibility / view_results
 * - error
 */

import { prisma } from '@eligibility-agent/db';
import { FastifyRequest } from 'fastify';
import { serviceLogger } from '../lib/logger.js';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'view_patient'
  | 'view_coverage'
  | 'check_eligibility'
  | 'view_results'
  | 'view_history'
  | 'error';

export interface AuditEntry {
  tenantId: string;
  sessionId?: string;
  userFhirId?: string;
  userName?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  patientFhirId?: string;
  requestIp?: string;
  userAgent?: string;
  requestPath?: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit log.
 *
 * NEVER throws, NEVER blocks.
 * Logs to database; if DB write fails, logs to stdout as fallback.
 */
export function audit(entry: AuditEntry): void {
  // Async write to DB - don't await
  prisma.auditLog
    .create({
      data: {
        tenantId: entry.tenantId,
        sessionId: entry.sessionId,
        userFhirId: entry.userFhirId,
        userName: entry.userName,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        patientFhirId: entry.patientFhirId,
        requestIp: entry.requestIp,
        userAgent: entry.userAgent,
        requestPath: entry.requestPath,
        success: entry.success,
        errorCode: entry.errorCode,
        errorMessage: entry.errorMessage,
        details: entry.details as object | undefined,
      },
    })
    .then(() => {
      serviceLogger.debug({ action: entry.action, tenantId: entry.tenantId }, 'Audit log written');
    })
    .catch((err: unknown) => {
      // Fallback: log to stdout (for log aggregation systems)
      serviceLogger.error(
        {
          err,
          auditEntry: {
            // Don't log PHI in error fallback - just metadata
            tenantId: entry.tenantId,
            action: entry.action,
            success: entry.success,
            errorCode: entry.errorCode,
          },
        },
        'Audit log DB write failed - logged to stdout'
      );
    });
}

/**
 * Audit with request context.
 *
 * Automatically extracts tenant, session, user info, IP, and user agent from request.
 */
export function auditRequest(
  request: FastifyRequest,
  entry: Omit<
    AuditEntry,
    | 'tenantId'
    | 'sessionId'
    | 'userFhirId'
    | 'userName'
    | 'requestIp'
    | 'userAgent'
    | 'requestPath'
  >
): void {
  audit({
    ...entry,
    tenantId: request.session?.tenantId ?? 'unknown',
    sessionId: request.session?.id,
    userFhirId: request.session?.userFhirId ?? undefined,
    userName: request.session?.userName ?? undefined,
    requestIp: request.ip,
    userAgent: request.headers['user-agent'],
    requestPath: request.url,
  });
}

/**
 * Audit a successful login.
 */
export function auditLogin(
  tenantId: string,
  sessionId: string,
  userFhirId: string | null,
  userName: string | null,
  requestIp: string,
  userAgent: string | undefined
): void {
  audit({
    tenantId,
    sessionId,
    userFhirId: userFhirId ?? undefined,
    userName: userName ?? undefined,
    action: 'login',
    requestIp,
    userAgent,
    success: true,
  });
}

/**
 * Audit a logout.
 */
export function auditLogout(request: FastifyRequest): void {
  if (request.session) {
    audit({
      tenantId: request.session.tenantId,
      sessionId: request.session.id,
      userFhirId: request.session.userFhirId ?? undefined,
      userName: request.session.userName ?? undefined,
      action: 'logout',
      requestIp: request.ip,
      userAgent: request.headers['user-agent'],
      requestPath: request.url,
      success: true,
    });
  }
}

/**
 * Audit viewing a patient record.
 */
export function auditViewPatient(
  request: FastifyRequest,
  patientFhirId: string
): void {
  auditRequest(request, {
    action: 'view_patient',
    resourceType: 'Patient',
    resourceId: patientFhirId,
    patientFhirId,
    success: true,
  });
}

/**
 * Audit viewing coverage/insurance information.
 */
export function auditViewCoverage(
  request: FastifyRequest,
  patientFhirId: string,
  coverageId?: string
): void {
  auditRequest(request, {
    action: 'view_coverage',
    resourceType: 'Coverage',
    resourceId: coverageId,
    patientFhirId,
    success: true,
  });
}

/**
 * Audit an eligibility check.
 */
export function auditEligibilityCheck(
  request: FastifyRequest,
  patientFhirId: string,
  success: boolean,
  details?: Record<string, unknown>
): void {
  auditRequest(request, {
    action: 'check_eligibility',
    resourceType: 'Eligibility',
    patientFhirId,
    success,
    details,
  });
}

/**
 * Audit viewing eligibility results.
 */
export function auditViewResults(
  request: FastifyRequest,
  agentRunId: string,
  patientFhirId: string
): void {
  auditRequest(request, {
    action: 'view_results',
    resourceType: 'AgentRun',
    resourceId: agentRunId,
    patientFhirId,
    success: true,
  });
}

/**
 * Audit viewing history.
 */
export function auditViewHistory(request: FastifyRequest): void {
  auditRequest(request, {
    action: 'view_history',
    success: true,
  });
}

/**
 * Audit an error.
 */
export function auditError(
  request: FastifyRequest,
  errorCode: string,
  errorMessage: string,
  patientFhirId?: string
): void {
  auditRequest(request, {
    action: 'error',
    patientFhirId,
    success: false,
    errorCode,
    errorMessage,
  });
}
