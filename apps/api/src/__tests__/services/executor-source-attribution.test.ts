/**
 * Tests for executor source attribution passthrough
 *
 * These tests verify that the actual executeTool function correctly
 * passes through sourceAttribution from Stedi responses to the agent loop.
 *
 * We mock the Stedi service to isolate the executor behavior.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { EligibilityResponse, SourceAttribution } from '@eligibility-agent/shared';

// Mock the stedi service BEFORE importing executor
// Type matches checkEligibilityWithStedi(params: EligibilityParams): Promise<EligibilityResponse>
const mockCheckEligibilityWithStedi = jest.fn<(params: Record<string, unknown>) => Promise<EligibilityResponse>>();

jest.unstable_mockModule('../../services/stedi.js', () => ({
  checkEligibilityWithStedi: mockCheckEligibilityWithStedi,
}));

// Mock the logger to avoid noise in tests
jest.unstable_mockModule('../../lib/logger.js', () => ({
  serviceLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Dynamic import AFTER mocking
const { executeTool } = await import('../../services/agent/executor.js');

describe('Executor Source Attribution Passthrough', () => {
  // Valid input that passes executor validation
  const validInput = {
    stediPayerId: 'AETNA',
    memberId: 'MEM123456',
    patientFirstName: 'John',
    patientLastName: 'Doe',
    patientDob: '1990-01-15',
    providerNpi: '1234567890',
    providerFirstName: 'Jane',
    providerLastName: 'Smith',
    serviceTypeCode: '30',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('check_eligibility tool', () => {
    it('should pass through sourceAttribution from Stedi response', async () => {
      const mockSourceAttribution: SourceAttribution = {
        payer: 'Aetna Health',
        payerId: 'AETNA',
        timestamp: '2026-01-29T10:30:00.000Z',
        responseFormat: 'X12_271',
        transactionId: 'CTL123456',
        stediRequestId: 'stedi-req-abc123',
      };

      mockCheckEligibilityWithStedi.mockResolvedValue({
        status: 'active',
        planName: 'Aetna Choice POS II',
        benefits: [],
        sourceAttribution: mockSourceAttribution,
      });

      const result = await executeTool('check_eligibility', validInput);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const data = result.data as Record<string, unknown>;
      expect(data.sourceAttribution).toBeDefined();
      expect(data.sourceAttribution).toEqual(mockSourceAttribution);
    });

    it('should preserve all sourceAttribution fields', async () => {
      const fullSourceAttribution: SourceAttribution = {
        payer: 'United Healthcare',
        payerId: 'UHC',
        timestamp: '2026-01-29T12:00:00.000Z',
        responseFormat: 'X12_271',
        transactionId: 'TXN-789',
        stediRequestId: 'req-xyz-123',
      };

      mockCheckEligibilityWithStedi.mockResolvedValue({
        status: 'active',
        planName: 'UHC Gold',
        benefits: [],
        sourceAttribution: fullSourceAttribution,
      });

      const result = await executeTool('check_eligibility', validInput);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      const returnedSource = data.sourceAttribution as SourceAttribution;

      expect(returnedSource.payer).toBe('United Healthcare');
      expect(returnedSource.payerId).toBe('UHC');
      expect(returnedSource.timestamp).toBe('2026-01-29T12:00:00.000Z');
      expect(returnedSource.responseFormat).toBe('X12_271');
      expect(returnedSource.transactionId).toBe('TXN-789');
      expect(returnedSource.stediRequestId).toBe('req-xyz-123');
    });

    it('should handle undefined sourceAttribution gracefully', async () => {
      mockCheckEligibilityWithStedi.mockResolvedValue({
        status: 'active',
        planName: 'Test Plan',
        benefits: [],
        // sourceAttribution intentionally omitted
      });

      const result = await executeTool('check_eligibility', validInput);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      // sourceAttribution key should exist but be undefined
      expect('sourceAttribution' in data).toBe(true);
      expect(data.sourceAttribution).toBeUndefined();
    });

    it('should include sourceAttribution alongside all other eligibility fields', async () => {
      mockCheckEligibilityWithStedi.mockResolvedValue({
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
      });

      const result = await executeTool('check_eligibility', validInput);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;

      // Verify all standard fields are present
      expect(data.status).toBe('active');
      expect(data.planName).toBe('Premium Plan');
      expect(data.planType).toBe('HMO');
      expect(data.effectiveDate).toBe('2026-01-01');
      expect(data.terminationDate).toBe('2026-12-31');
      expect(data.copay).toBeDefined();
      expect(data.deductible).toBeDefined();
      expect(data.outOfPocketMax).toBeDefined();
      expect(data.coinsurance).toBeDefined();
      expect(data.benefits).toBeDefined();
      expect(data.warnings).toBeDefined();
      expect(data.rawResponse).toBeDefined();

      // AND sourceAttribution is also present
      expect(data.sourceAttribution).toBeDefined();
      expect((data.sourceAttribution as SourceAttribution).payer).toBe('Cigna');
    });

    it('should limit benefits to 10 items while preserving sourceAttribution', async () => {
      const manyBenefits = Array.from({ length: 15 }, (_, i) => ({
        serviceType: `Service ${i}`,
        serviceTypeCode: `${i}`,
        inNetwork: true,
      }));

      mockCheckEligibilityWithStedi.mockResolvedValue({
        status: 'active',
        benefits: manyBenefits,
        sourceAttribution: {
          payer: 'Test',
          payerId: 'TEST',
          timestamp: new Date().toISOString(),
          responseFormat: 'X12_271',
        },
      });

      const result = await executeTool('check_eligibility', validInput);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.benefits).toHaveLength(10);
      // sourceAttribution should still be present
      expect(data.sourceAttribution).toBeDefined();
    });

    it('should call Stedi service with correct parameters', async () => {
      mockCheckEligibilityWithStedi.mockResolvedValue({
        status: 'active',
        benefits: [],
        sourceAttribution: {
          payer: 'Test',
          payerId: 'TEST',
          timestamp: new Date().toISOString(),
          responseFormat: 'X12_271',
        },
      });

      await executeTool('check_eligibility', validInput);

      expect(mockCheckEligibilityWithStedi).toHaveBeenCalledTimes(1);
      expect(mockCheckEligibilityWithStedi).toHaveBeenCalledWith({
        stediPayerId: 'AETNA',
        memberId: 'MEM123456',
        patientFirstName: 'John',
        patientLastName: 'Doe',
        patientDob: '1990-01-15',
        providerNpi: '1234567890',
        providerFirstName: 'Jane',
        providerLastName: 'Smith',
        providerOrganizationName: undefined,
        serviceTypeCode: '30',
        groupNumber: undefined,
      });
    });
  });
});
