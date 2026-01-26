// Load .env from monorepo root (only in development - production uses Fly secrets)
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.default.config({ path: resolve(__dirname, '../../../.env') });
}
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';

import authRoutes from './routes/auth.js';
import fhirRoutes from './routes/fhir.js';
import npiRoutes from './routes/npi.js';
import eligibilityRoutes from './routes/eligibility.js';
import agentRoutes from './routes/agent.js';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  },
});

// Plugins
await fastify.register(cors, {
  // Use CORS_ORIGIN env var, or allow requesting origin in development
  origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'development' ? true : false),
  credentials: true,
});
await fastify.register(formbody);
await fastify.register(multipart);

// Routes
await fastify.register(authRoutes, { prefix: '/auth' });
await fastify.register(fhirRoutes, { prefix: '/fhir' });
await fastify.register(npiRoutes, { prefix: '/npi' });
await fastify.register(eligibilityRoutes, { prefix: '/eligibility' });
await fastify.register(agentRoutes, { prefix: '/agent' });

// Health check
fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Start server
const port = parseInt(process.env.PORT || '3001', 10);
const host = process.env.HOST || '0.0.0.0';

try {
  await fastify.listen({ port, host });
  console.log(`API server running at http://${host}:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
