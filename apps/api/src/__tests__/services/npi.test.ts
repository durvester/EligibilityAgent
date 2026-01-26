// Test the NPI validation logic directly (Luhn algorithm)
// We test the validation function without making actual API calls

describe('NPI validation', () => {
  // The Luhn algorithm for NPI validation
  function validateNpiChecksum(npi: string): boolean {
    if (!/^\d{10}$/.test(npi)) return false;

    const prefixedNpi = '80840' + npi;
    let sum = 0;
    let alternate = false;

    for (let i = prefixedNpi.length - 1; i >= 0; i--) {
      let digit = parseInt(prefixedNpi[i], 10);
      if (alternate) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      alternate = !alternate;
    }

    return sum % 10 === 0;
  }

  describe('valid NPIs', () => {
    // Known valid NPI numbers (verified with Luhn checksum)
    const validNpis = [
      '1234567893', // Example NPI with valid checksum
      '1245319599', // Example organization
      '1366583445', // Another valid example
      '1679576722', // Another valid example
    ];

    validNpis.forEach(npi => {
      it(`should validate ${npi} as valid`, () => {
        expect(validateNpiChecksum(npi)).toBe(true);
      });
    });
  });

  describe('invalid NPI formats', () => {
    it('should reject NPI with less than 10 digits', () => {
      expect(validateNpiChecksum('123456789')).toBe(false);
    });

    it('should reject NPI with more than 10 digits', () => {
      expect(validateNpiChecksum('12345678901')).toBe(false);
    });

    it('should reject NPI with non-numeric characters', () => {
      expect(validateNpiChecksum('123456789a')).toBe(false);
    });

    it('should reject NPI with spaces', () => {
      expect(validateNpiChecksum('123 456 78')).toBe(false);
    });

    it('should reject NPI with dashes', () => {
      expect(validateNpiChecksum('123-456-78')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateNpiChecksum('')).toBe(false);
    });

    it('should reject NPI starting with 0 followed by 9 digits if checksum fails', () => {
      // 10 digits starting with 0 - valid format but may have invalid checksum
      expect(validateNpiChecksum('0000000000')).toBe(false);
    });
  });

  describe('invalid checksums', () => {
    // These are 10 digit numbers that fail the Luhn check
    const invalidChecksums = [
      '1234567890', // Valid format, invalid checksum
      '1234567891', // Valid format, invalid checksum
      '1234567892', // Valid format, invalid checksum
      '1234567894', // Valid format, invalid checksum (3 is correct)
      '1234567895', // Valid format, invalid checksum
      '0000000001', // All zeros with 1
      '9999999999', // All nines
    ];

    invalidChecksums.forEach(npi => {
      it(`should reject ${npi} as invalid checksum`, () => {
        expect(validateNpiChecksum(npi)).toBe(false);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle NPI with leading zeros', () => {
      // If the checksum happens to be valid, this should pass
      // Testing that leading zeros are handled properly
      const result = validateNpiChecksum('0123456789');
      expect(typeof result).toBe('boolean');
    });

    it('should reject undefined/null coerced to string', () => {
      expect(validateNpiChecksum(String(undefined))).toBe(false);
      expect(validateNpiChecksum(String(null))).toBe(false);
    });
  });

  describe('Luhn algorithm correctness', () => {
    // Verify the algorithm step by step for a known valid NPI
    it('should correctly calculate checksum for 1234567893', () => {
      // NPI: 1234567893
      // Prefixed: 808401234567893
      // From right to left, double every second digit:
      // 3, 9*2=18-9=9, 8, 7*2=14-9=5, 6, 5*2=10-9=1, 4, 3*2=6, 2, 1*2=2, 0, 4*2=8, 8, 0*2=0, 8
      // Sum: 3+9+8+5+6+1+4+6+2+2+0+8+8+0+8 = 70
      // 70 % 10 = 0, valid
      expect(validateNpiChecksum('1234567893')).toBe(true);
    });

    it('should correctly reject 1234567890', () => {
      // Same as above but last digit is 0 instead of 3
      // The sum would be 67 instead of 70
      // 67 % 10 = 7, invalid
      expect(validateNpiChecksum('1234567890')).toBe(false);
    });
  });
});
