/**
 * Health Check Routes
 *
 * Provides health check endpoint for monitoring and load balancer probes.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@eligibility-agent/db';
import { checkRedisHealth } from '../lib/redis.js';

interface HealthCheckResult {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
  };
}

/**
 * Check database connectivity.
 */
async function checkDatabase(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Health check endpoint.
   *
   * Returns:
   * - 200 if all checks pass
   * - 503 if any check fails
   */
  fastify.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    const [dbResult, redisResult] = await Promise.all([
      checkDatabase(),
      checkRedisHealth(),
    ]);

    const checks = {
      database: dbResult,
      redis: redisResult,
    };

    const allHealthy = dbResult.status === 'ok' && redisResult.status === 'ok';

    const response: HealthResponse = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };

    return reply.status(allHealthy ? 200 : 503).send(response);
  });

  /**
   * Simple liveness probe (just returns 200).
   * Use for Kubernetes liveness probes that only need to know the process is running.
   */
  fastify.get('/health/live', async () => {
    return { status: 'ok' };
  });

  /**
   * Readiness probe (checks dependencies).
   * Use for Kubernetes readiness probes before accepting traffic.
   */
  fastify.get('/health/ready', async (_request, reply) => {
    const [dbResult, redisResult] = await Promise.all([
      checkDatabase(),
      checkRedisHealth(),
    ]);

    const ready = dbResult.status === 'ok' && redisResult.status === 'ok';

    if (ready) {
      return { status: 'ready' };
    }

    return reply.status(503).send({
      status: 'not_ready',
      checks: {
        database: dbResult.status,
        redis: redisResult.status,
      },
    });
  });
};

export default healthRoutes;
