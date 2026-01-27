/**
 * Agent Route - SSE Endpoint for Eligibility Agent
 *
 * Streams agent events to the client in real-time using Server-Sent Events.
 * Uses @fastify/sse plugin for proper SSE handling.
 */

import { FastifyPluginAsync } from 'fastify';
import type { AgentInput, AgentEvent, FhirPatient, FhirCoverage, FhirPractitioner } from '@eligibility-agent/shared';
import { runEligibilityAgent, type AgentContext } from '../services/agent/loop.js';
import { auditEligibilityCheck } from '../services/audit-service.js';

interface EligibilityAgentBody {
  patient: AgentInput['patient'];
  insurance?: AgentInput['insurance'];
  provider?: AgentInput['provider'];
  serviceTypeCode?: string;
  cardImage?: string;
  rawFhir?: {
    patient?: FhirPatient;
    coverage?: FhirCoverage;
    practitioner?: FhirPractitioner;
  };
}

interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate minimum required fields before starting the agent.
 * Returns an array of validation errors (empty if valid).
 */
function validateAgentInput(body: EligibilityAgentBody): ValidationError[] {
  const errors: ValidationError[] = [];

  // Patient is required
  if (!body.patient) {
    errors.push({ field: 'patient', message: 'Patient information is required' });
    return errors; // Can't check further without patient
  }

  // Patient first name required
  if (!body.patient.firstName?.trim()) {
    errors.push({ field: 'patient.firstName', message: 'Patient first name is required' });
  }

  // Patient last name required
  if (!body.patient.lastName?.trim()) {
    errors.push({ field: 'patient.lastName', message: 'Patient last name is required' });
  }

  // Patient DOB required (Stedi needs this)
  if (!body.patient.dateOfBirth?.trim()) {
    errors.push({ field: 'patient.dateOfBirth', message: 'Patient date of birth is required' });
  }

  // Provider: need either NPI or name (agent can look up NPI from name)
  const hasProviderNpi = body.provider?.npi?.trim();
  const hasProviderName = body.provider?.firstName?.trim() && body.provider?.lastName?.trim();

  if (!hasProviderNpi && !hasProviderName) {
    errors.push({
      field: 'provider',
      message: 'Provider is required. Provide either NPI or provider name (first + last).',
    });
  }

  return errors;
}

const agentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /agent/eligibility
   *
   * Runs the eligibility agent and streams events via SSE.
   * Uses @fastify/sse plugin with async generator for proper streaming.
   *
   * Request body: AgentInput
   * Response: SSE stream of AgentEvent objects
   *
   * Minimum requirements:
   * - Patient first name, last name, DOB
   * - Provider NPI OR provider name (first + last)
   */
  fastify.post<{ Body: EligibilityAgentBody }>('/eligibility', { sse: true }, async (request, reply) => {
    const requestId = `req-${Date.now()}`;
    const startTime = Date.now();

    const { patient, insurance, provider, serviceTypeCode, cardImage, rawFhir } = request.body;

    // Validate minimum requirements
    const validationErrors = validateAgentInput(request.body);
    if (validationErrors.length > 0) {
      fastify.log.warn({ requestId, validationErrors }, 'Validation failed');
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields',
          details: validationErrors,
        },
      });
    }

    fastify.log.info({
      requestId,
      patient: { firstName: patient.firstName, lastName: patient.lastName },
      hasMemberId: !!insurance?.memberId,
      hasPayerName: !!insurance?.payerName,
      hasProviderNpi: !!provider?.npi,
      hasProviderName: !!(provider?.firstName && provider?.lastName),
      hasCardImage: !!cardImage,
      hasRawFhir: !!rawFhir,
    }, 'Starting eligibility agent');

    const input: AgentInput = {
      patient,
      insurance,
      provider,
      serviceTypeCode,
      cardImage,
      rawFhir,
    };

    // Build context for persistence (if we have a session)
    const context: AgentContext | undefined = request.session ? {
      tenantId: request.session.tenantId,
      sessionId: request.session.id,
      patientFhirId: patient.fhirId || 'unknown',
    } : undefined;

    // Audit the eligibility check start
    if (request.session) {
      auditEligibilityCheck(request, patient.fhirId || 'unknown', true, {
        hasInsurance: !!insurance,
        hasProvider: !!provider,
      });
    }

    // Track disconnection via abort signal
    const abortController = new AbortController();
    request.raw.on('close', () => {
      abortController.abort();
      fastify.log.info({ requestId, elapsed: Date.now() - startTime }, 'Client disconnected from agent SSE');
    });

    /**
     * Async generator that yields SSE events.
     * @fastify/sse plugin handles the SSE protocol.
     */
    async function* eventStream(): AsyncGenerator<{ data: AgentEvent }> {
      // Send initial start event
      yield { data: { type: 'start' } as AgentEvent };

      let eventCount = 0;
      try {
        // Run the agent and stream events
        for await (const event of runEligibilityAgent(input, context)) {
          eventCount++;

          // Check if client disconnected
          if (abortController.signal.aborted) {
            fastify.log.info({ requestId, eventCount, elapsed: Date.now() - startTime }, 'Stopping agent - client disconnected');
            return;
          }

          // Log significant events
          if (event.type === 'tool_start') {
            fastify.log.info({ requestId, tool: event.tool }, 'Agent calling tool');
          } else if (event.type === 'tool_end') {
            fastify.log.info({ requestId, tool: event.tool, success: (event.result as { success?: boolean })?.success }, 'Tool completed');
          } else if (event.type === 'complete') {
            fastify.log.info({
              requestId,
              status: event.eligibilityResult?.status,
              inputTokens: event.usage?.inputTokens,
              outputTokens: event.usage?.outputTokens,
              cost: event.usage?.estimatedCost?.toFixed(4),
              elapsed: Date.now() - startTime,
            }, 'Agent completed');
          } else if (event.type === 'error') {
            fastify.log.error({ requestId, message: event.message }, 'Agent error');
          }

          yield { data: event };
        }

        fastify.log.info({ requestId, eventCount, elapsed: Date.now() - startTime }, 'Agent loop finished');

      } catch (error) {
        fastify.log.error({ requestId, error, elapsed: Date.now() - startTime }, 'Agent failed with exception');

        // Send error event
        yield {
          data: {
            type: 'error',
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
          } as AgentEvent,
        };
      }
    }

    // CRITICAL: Set headers to disable proxy buffering (Fly.io, nginx, etc.)
    // Without these, the response may be buffered causing immediate client disconnect
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // nginx
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');

    // Use @fastify/sse plugin to stream the events
    // The plugin serializes data to JSON automatically
    return reply.sse.send(eventStream());
  });

  /**
   * GET /agent/health
   *
   * Health check for the agent endpoint.
   */
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      agent: 'eligibility',
      model: 'claude-sonnet-4-20250514',
      features: {
        extendedThinking: true,
        insuranceCardOcr: true,
        rawFhirContext: true,
      },
      timestamp: new Date().toISOString(),
    };
  });
};

export default agentRoutes;
