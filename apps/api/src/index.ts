// Load .env from monorepo root (only in development - production uses Fly secrets)
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.default.config({ path: resolve(__dirname, '../../../.env') });
}

// Validate environment before proceeding
import { validateEnvironmentOrExit } from './lib/validate-env.js';
validateEnvironmentOrExit();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifySSE from '@fastify/sse';

import authRoutes from './routes/auth.js';
import fhirRoutes from './routes/fhir.js';
import npiRoutes from './routes/npi.js';
import eligibilityRoutes from './routes/eligibility.js';
import agentRoutes from './routes/agent.js';
import healthRoutes from './routes/health.js';
import historyRoutes from './routes/history.js';
import { sessionMiddleware, requireSession } from './middleware/session.js';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  },
  // Request body size limit (10MB)
  bodyLimit: 10 * 1024 * 1024,
});

// Register plugins
await fastify.register(cors, {
  // Use CORS_ORIGIN env var, or allow requesting origin in development
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'development' ? true : false),
  credentials: true, // Required for cookies
});

await fastify.register(cookie);
await fastify.register(formbody);
await fastify.register(multipart);
// @ts-expect-error - CJS/ESM interop issue with @fastify/sse types
await fastify.register(fastifySSE);

// Rate limiting
await fastify.register(rateLimit, {
  max: 100, // 100 requests per minute per IP
  timeWindow: '1 minute',
  // More permissive for health checks
  allowList: (request) => request.url === '/health',
  // Custom key generator (uses IP + path for better control)
  keyGenerator: (request) => {
    return `${request.ip}-${request.routeOptions?.url || request.url}`;
  },
});

// Add HSTS header in production
if (process.env.NODE_ENV === 'production') {
  fastify.addHook('onSend', async (_request, reply) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });
}

// ============================================================================
// Public routes (no auth required)
// ============================================================================
await fastify.register(authRoutes, { prefix: '/auth' });
await fastify.register(npiRoutes, { prefix: '/npi' });
await fastify.register(healthRoutes);

// ============================================================================
// Protected routes (require valid session)
// ============================================================================
await fastify.register(async (instance) => {
  // Apply session middleware to all routes in this scope
  instance.addHook('onRequest', sessionMiddleware);
  instance.addHook('onRequest', requireSession);

  // FHIR proxy
  await instance.register(fhirRoutes, { prefix: '/fhir' });

  // Eligibility check (legacy endpoint)
  await instance.register(eligibilityRoutes, { prefix: '/eligibility' });

  // Agent history
  await instance.register(historyRoutes, { prefix: '/history' });
});

// Protected routes with additional rate limiting for agent
await fastify.register(async (instance) => {
  // Apply session middleware
  instance.addHook('onRequest', sessionMiddleware);
  instance.addHook('onRequest', requireSession);

  // Stricter rate limit for agent endpoints (expensive AI calls)
  await instance.register(rateLimit, {
    max: 10, // 10 requests per minute for agent
    timeWindow: '1 minute',
  });

  await instance.register(agentRoutes);
}, { prefix: '/agent' });

// Start server
const port = parseInt(process.env.PORT || '3001', 10);
const host = process.env.HOST || '0.0.0.0';

try {
  await fastify.listen({ port, host });
  fastify.log.info({ port, host }, `API server running at http://${host}:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
