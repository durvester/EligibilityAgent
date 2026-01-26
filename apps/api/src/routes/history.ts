/**
 * History Routes
 *
 * Provides access to agent run history for the current tenant.
 * All routes require authentication.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@eligibility-agent/db';
import { auditViewHistory, auditViewResults } from '../services/audit-service.js';

interface HistoryListQuery {
  limit?: number;
  offset?: number;
  patientFhirId?: string;
}

interface HistoryListItem {
  id: string;
  patientFhirId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
}

interface HistoryDetail {
  id: string;
  tenantId: string;
  sessionId: string | null;
  patientFhirId: string;
  inputPayload: unknown;
  status: string;
  eligibilityResult: unknown | null;
  summary: string | null;
  discrepancies: unknown | null;
  rawStediResponse: unknown | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  errorMessage: string | null;
}

const historyRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * List agent runs for the current tenant.
   *
   * GET /history?limit=50&offset=0&patientFhirId=123
   */
  fastify.get<{ Querystring: HistoryListQuery }>('/', async (request, reply) => {
    const session = request.session;
    if (!session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    const limit = Math.min(request.query.limit || 50, 100);
    const offset = request.query.offset || 0;
    const patientFhirId = request.query.patientFhirId;

    // Audit the history view
    auditViewHistory(request);

    const whereClause = {
      tenantId: session.tenantId,
      ...(patientFhirId && { patientFhirId }),
    };

    const [runs, total] = await Promise.all([
      prisma.agentRun.findMany({
        where: whereClause,
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          patientFhirId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
        },
      }),
      prisma.agentRun.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: runs as HistoryListItem[],
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + runs.length < total,
      },
    };
  });

  /**
   * Get a single agent run by ID.
   *
   * GET /history/:id
   */
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const session = request.session;
    if (!session) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    const run = await prisma.agentRun.findFirst({
      where: {
        id: request.params.id,
        tenantId: session.tenantId, // Ensure tenant isolation
      },
    });

    if (!run) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Agent run not found' },
      });
    }

    // Audit the result view
    auditViewResults(request, run.id, run.patientFhirId);

    // Convert Decimal to number for JSON serialization
    const responseData: HistoryDetail = {
      ...run,
      estimatedCost: run.estimatedCost ? Number(run.estimatedCost) : null,
    };

    return {
      success: true,
      data: responseData,
    };
  });

  /**
   * Get agent runs for a specific patient.
   *
   * GET /history/patient/:patientFhirId
   */
  fastify.get<{ Params: { patientFhirId: string }; Querystring: { limit?: number } }>(
    '/patient/:patientFhirId',
    async (request, reply) => {
      const session = request.session;
      if (!session) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const limit = Math.min(request.query.limit || 10, 50);

      const runs = await prisma.agentRun.findMany({
        where: {
          tenantId: session.tenantId,
          patientFhirId: request.params.patientFhirId,
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          eligibilityResult: true,
          summary: true,
        },
      });

      return {
        success: true,
        data: runs,
      };
    }
  );
};

export default historyRoutes;
