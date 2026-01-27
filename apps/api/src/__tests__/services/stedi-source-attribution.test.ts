/**
 * Tests for Stedi service source attribution extraction
 *
 * Tests the parseStediResponse function directly without mocking axios.
 */

import { parseStediResponse } from '../../services/stedi.js';

describe('Stedi Source Attribution', () => {
  const baseSourceInfo = {
    payerId: 'AETNA',
    payerName: 'Aetna Health',
    requestId: 'stedi-req-abc123',
  };

  describe('sourceAttribution field', () => {
    it('should include all sourceAttribution fields in response', () => {
      const mockResponse = {
        controlNumber: 'CTL123456',
        planInformation: {
          planName: 'Aetna Choice POS II',
        },
        benefitsInformation: [
          {
            code: '1',
            serviceType: 'Health Benefit Plan Coverage',
          },
        ],
      };

      const result = parseStediResponse(mockResponse, baseSourceInfo);

      expect(result.sourceAttribution).toBeDefined();
      expect(result.sourceAttribution?.payer).toBe('Aetna Health');
      expect(result.sourceAttribution?.payerId).toBe('AETNA');
      expect(result.sourceAttribution?.responseFormat).toBe('X12_271');
      expect(result.sourceAttribution?.transactionId).toBe('CTL123456');
      expect(result.sourceAttribution?.stediRequestId).toBe('stedi-req-abc123');
    });

    it('should use payerId as payer name when payerName is not provided', () => {
      const mockResponse = {
        benefitsInformation: [],
      };

      const result = parseStediResponse(mockResponse, {
        payerId: 'BCBS_TX',
      });

      expect(result.sourceAttribution?.payer).toBe('BCBS_TX');
      expect(result.sourceAttribution?.payerId).toBe('BCBS_TX');
    });

    it('should generate valid ISO timestamp', () => {
      const mockResponse = { benefitsInformation: [] };

      const result = parseStediResponse(mockResponse, baseSourceInfo);

      expect(result.sourceAttribution?.timestamp).toBeDefined();
      // Verify it's a valid ISO date string
      const parsedDate = new Date(result.sourceAttribution!.timestamp);
      expect(parsedDate.toISOString()).toBe(result.sourceAttribution!.timestamp);
      // Verify it's recent (within last minute)
      const now = Date.now();
      const timestampMs = parsedDate.getTime();
      expect(now - timestampMs).toBeLessThan(60000);
    });

    it('should handle missing controlNumber gracefully', () => {
      const mockResponse = {
        planInformation: {
          planName: 'Blue Cross PPO',
        },
        benefitsInformation: [],
      };

      const result = parseStediResponse(mockResponse, {
        payerId: 'BCBS',
      });

      expect(result.sourceAttribution).toBeDefined();
      expect(result.sourceAttribution?.transactionId).toBeUndefined();
      expect(result.sourceAttribution?.stediRequestId).toBeUndefined();
    });

    it('should extract transactionId from alternate field', () => {
      const mockResponse = {
        transactionId: 'TXN-ALTERNATE-789',
        benefitsInformation: [],
      };

      const result = parseStediResponse(mockResponse, baseSourceInfo);

      expect(result.sourceAttribution?.transactionId).toBe('TXN-ALTERNATE-789');
    });

    it('should prefer controlNumber over transactionId', () => {
      const mockResponse = {
        controlNumber: 'CTL-PRIMARY',
        transactionId: 'TXN-ALTERNATE',
        benefitsInformation: [],
      };

      const result = parseStediResponse(mockResponse, baseSourceInfo);

      expect(result.sourceAttribution?.transactionId).toBe('CTL-PRIMARY');
    });
  });

  describe('eligibility parsing with source attribution', () => {
    it('should include sourceAttribution alongside eligibility data', () => {
      const mockResponse = {
        controlNumber: 'CTL999',
        planInformation: {
          planName: 'Premium Health Plan',
          planType: 'PPO',
        },
        benefitsInformation: [
          {
            code: '1',
            serviceType: 'Health Benefit Plan Coverage',
          },
          {
            code: 'B',
            serviceType: 'Office Visit',
            benefitAmount: '25',
            inPlanNetwork: 'Y',
          },
        ],
      };

      const result = parseStediResponse(mockResponse, baseSourceInfo);

      // Verify eligibility data
      expect(result.status).toBe('active');
      expect(result.planName).toBe('Premium Health Plan');
      expect(result.planType).toBe('PPO');
      expect(result.copay).toBeDefined();
      expect(result.copay?.[0].amount).toBe(25);

      // Verify source attribution is still present
      expect(result.sourceAttribution).toBeDefined();
      expect(result.sourceAttribution?.transactionId).toBe('CTL999');
    });

    it('should include sourceAttribution even when parsing fails', () => {
      // Malformed response
      const mockResponse = null;

      const result = parseStediResponse(mockResponse, baseSourceInfo);

      // Parsing should fail gracefully
      expect(result.status).toBe('unknown');
      expect(result.errors).toContain('Failed to parse eligibility response');

      // But sourceAttribution should still be present
      expect(result.sourceAttribution).toBeDefined();
      expect(result.sourceAttribution?.payer).toBe('Aetna Health');
    });
  });

  describe('responseFormat field', () => {
    it('should always be X12_271', () => {
      const responses = [
        { benefitsInformation: [] },
        { planInformation: {}, benefitsInformation: [] },
        null,
        undefined,
      ];

      for (const mockResponse of responses) {
        const result = parseStediResponse(mockResponse, baseSourceInfo);
        expect(result.sourceAttribution?.responseFormat).toBe('X12_271');
      }
    });
  });
});
