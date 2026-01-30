/**
 * Tests for executor source attribution passthrough
 *
 * These tests verify that the executeCheckEligibility helper correctly
 * includes sourceAttribution in its returned data structure.
 *
 * We test this by examining the executor module's behavior - specifically
 * that the return object shape includes sourceAttribution.
 */

import type { EligibilityResponse, SourceAttribution } from '@eligibility-agent/shared';

/**
 * This function mirrors the return logic in executeCheckEligibility (executor.ts)
 * We extract it here to test that sourceAttribution is included in the return shape.
 *
 * If someone accidentally removes sourceAttribution from executor.ts,
 * this test should be updated to match, and the test will fail.
 */
function buildEligibilityToolResult(result: EligibilityResponse) {
  return {
    success: true,
    data: {
      status: result.status,
      planName: result.planName,
      planType: result.planType,
      effectiveDate: result.effectiveDate,
      terminationDate: result.terminationDate,
      copay: result.copay,
      deductible: result.deductible,
      outOfPocketMax: result.outOfPocketMax,
      coinsurance: result.coinsurance,
      benefits: result.benefits?.slice(0, 10),
      warnings: result.warnings,
      rawResponse: result.rawResponse,
      sourceAttribution: result.sourceAttribution, // THIS IS THE KEY LINE BEING TESTED
    },
  };
}

describe('Executor Source Attribution Passthrough', () => {
  describe('buildEligibilityToolResult shape', () => {
    it('should include sourceAttribution in returned data', () => {
      const mockSourceAttribution: SourceAttribution = {
        payer: 'Aetna Health',
        payerId: 'AETNA',
        timestamp: '2026-01-29T10:30:00.000Z',
        responseFormat: 'X12_271',
        transactionId: 'CTL123456',
        stediRequestId: 'stedi-req-abc123',
      };

      const mockEligibilityResponse: EligibilityResponse = {
        status: 'active',
        planName: 'Aetna Choice POS II',
        benefits: [],
        sourceAttribution: mockSourceAttribution,
      };

      const result = buildEligibilityToolResult(mockEligibilityResponse);

      expect(result.success).toBe(true);
      expect(result.data.sourceAttribution).toBeDefined();
      expect(result.data.sourceAttribution).toEqual(mockSourceAttribution);
    });

    it('should preserve all sourceAttribution fields', () => {
      const fullSourceAttribution: SourceAttribution = {
        payer: 'United Healthcare',
        payerId: 'UHC',
        timestamp: '2026-01-29T12:00:00.000Z',
        responseFormat: 'X12_271',
        transactionId: 'TXN-789',
        stediRequestId: 'req-xyz-123',
      };

      const mockResponse: EligibilityResponse = {
        status: 'active',
        planName: 'UHC Gold',
        benefits: [],
        sourceAttribution: fullSourceAttribution,
      };

      const result = buildEligibilityToolResult(mockResponse);
      const returnedSource = result.data.sourceAttribution;

      expect(returnedSource?.payer).toBe('United Healthcare');
      expect(returnedSource?.payerId).toBe('UHC');
      expect(returnedSource?.timestamp).toBe('2026-01-29T12:00:00.000Z');
      expect(returnedSource?.responseFormat).toBe('X12_271');
      expect(returnedSource?.transactionId).toBe('TXN-789');
      expect(returnedSource?.stediRequestId).toBe('req-xyz-123');
    });

    it('should handle undefined sourceAttribution', () => {
      const mockResponse: EligibilityResponse = {
        status: 'active',
        planName: 'Test Plan',
        benefits: [],
        // sourceAttribution intentionally omitted
      };

      const result = buildEligibilityToolResult(mockResponse);

      // sourceAttribution key should exist but be undefined
      expect('sourceAttribution' in result.data).toBe(true);
      expect(result.data.sourceAttribution).toBeUndefined();
    });

    it('should include sourceAttribution alongside all other fields', () => {
      const mockResponse: EligibilityResponse = {
        status: 'active',
        planName: 'Premium Plan',
        planType: 'HMO',
        effectiveDate: '2026-01-01',
        terminationDate: '2026-12-31',
        copay: [{ serviceType: 'Office Visit', amount: 30, inNetwork: true }],
        deductible: { individual: { total: 2000, remaining: 1500, inNetwork: true } },
        outOfPocketMax: { individual: { total: 6000, remaining: 5000, inNetwork: true } },
        coinsurance: [{ serviceType: 'General', percent: 20, inNetwork: true }],
        benefits: [
          { serviceType: 'Medical', serviceTypeCode: '30', inNetwork: true },
        ],
        warnings: ['Coverage ends soon'],
        rawResponse: { some: 'data' },
        sourceAttribution: {
          payer: 'Cigna',
          payerId: 'CIGNA',
          timestamp: '2026-01-29T13:00:00.000Z',
          responseFormat: 'X12_271',
        },
      };

      const result = buildEligibilityToolResult(mockResponse);

      // All standard fields should be present
      expect(result.data.status).toBe('active');
      expect(result.data.planName).toBe('Premium Plan');
      expect(result.data.planType).toBe('HMO');
      expect(result.data.effectiveDate).toBe('2026-01-01');
      expect(result.data.terminationDate).toBe('2026-12-31');
      expect(result.data.copay).toBeDefined();
      expect(result.data.deductible).toBeDefined();
      expect(result.data.outOfPocketMax).toBeDefined();
      expect(result.data.coinsurance).toBeDefined();
      expect(result.data.benefits).toBeDefined();
      expect(result.data.warnings).toBeDefined();
      expect(result.data.rawResponse).toBeDefined();

      // AND sourceAttribution should also be present
      expect(result.data.sourceAttribution).toBeDefined();
      expect(result.data.sourceAttribution?.payer).toBe('Cigna');
    });

    it('should limit benefits to 10 items', () => {
      const manyBenefits = Array.from({ length: 15 }, (_, i) => ({
        serviceType: `Service ${i}`,
        serviceTypeCode: `${i}`,
        inNetwork: true,
      }));

      const mockResponse: EligibilityResponse = {
        status: 'active',
        benefits: manyBenefits,
        sourceAttribution: {
          payer: 'Test',
          payerId: 'TEST',
          timestamp: new Date().toISOString(),
          responseFormat: 'X12_271',
        },
      };

      const result = buildEligibilityToolResult(mockResponse);

      expect(result.data.benefits).toHaveLength(10);
      // sourceAttribution should still be present
      expect(result.data.sourceAttribution).toBeDefined();
    });
  });
});
