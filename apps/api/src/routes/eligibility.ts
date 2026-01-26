import { FastifyPluginAsync } from 'fastify';
import type { EligibilityResponse, InsuranceInfo } from '@eligibility-agent/shared';

interface SaveBody {
  patientId: string;
  results: EligibilityResponse;
  insurance: InsuranceInfo;
}

const eligibilityRoutes: FastifyPluginAsync = async (fastify) => {
  // Save eligibility results to EHR
  fastify.post<{ Body: SaveBody }>('/save', async (request, reply) => {
    const { patientId, results, insurance } = request.body;

    if (!patientId || !results) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
      });
    }

    try {
      // TODO: Implement actual EHR write-back
      // 1. Generate PDF summary
      // 2. Upload PDF to Practice Fusion document API
      // 3. Upload JSON to Practice Fusion document API
      // 4. Update insurance record via Practice Fusion insurance API
      // 5. Save to local database for audit

      fastify.log.info({ patientId, status: results.status }, 'Saving eligibility results');

      // For now, just return success
      return {
        success: true,
        data: {
          savedAt: new Date().toISOString(),
          pdfUrl: null, // Would be URL to uploaded PDF
          jsonUrl: null, // Would be URL to uploaded JSON
        },
      };
    } catch (error) {
      fastify.log.error(error, 'Failed to save eligibility');
      return reply.status(500).send({
        success: false,
        error: { code: 'SAVE_FAILED', message: 'Failed to save eligibility results' },
      });
    }
  });

  // Get eligibility history for a patient
  fastify.get<{ Params: { patientId: string } }>('/history/:patientId', async (request, reply) => {
    const { patientId } = request.params;

    try {
      // TODO: Query from database
      // const checks = await prisma.eligibilityCheck.findMany({
      //   where: { patientFhirId: patientId },
      //   orderBy: { createdAt: 'desc' },
      //   take: 20,
      // });

      return {
        success: true,
        data: [], // Would return historical checks
      };
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch history');
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch eligibility history' },
      });
    }
  });
};

export default eligibilityRoutes;
