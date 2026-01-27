import { formatDate, formatDateOrNA } from '../../lib/format-date';

describe('formatDate', () => {
  it('formats YYYY-MM-DD date correctly', () => {
    expect(formatDate('1990-10-15')).toBe('Oct 15, 1990');
  });

  it('handles first day of month correctly', () => {
    expect(formatDate('2024-01-01')).toBe('Jan 1, 2024');
  });

  it('handles last day of month correctly', () => {
    expect(formatDate('2024-12-31')).toBe('Dec 31, 2024');
  });

  it('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('returns original string for invalid date format', () => {
    expect(formatDate('invalid')).toBe('invalid');
    expect(formatDate('15/10/1990')).toBe('15/10/1990');
  });

  // Critical test: Ensure timezone conversion doesn't cause off-by-one error
  // This was the bug where "1990-10-15" would display as "Oct 14, 1990" in US timezones
  it('does not shift date due to timezone conversion', () => {
    // Test multiple dates that would be affected by UTC conversion
    const testCases = [
      { input: '1990-10-15', expected: 'Oct 15, 1990' },
      { input: '2000-01-01', expected: 'Jan 1, 2000' },
      { input: '1985-12-31', expected: 'Dec 31, 1985' },
      { input: '2024-06-15', expected: 'Jun 15, 2024' },
    ];

    for (const { input, expected } of testCases) {
      const result = formatDate(input);
      // Extract just the day number to verify no off-by-one error
      const expectedDay = input.split('-')[2];
      expect(result).toContain(expectedDay.replace(/^0/, '')); // Remove leading zero
      expect(result).toBe(expected);
    }
  });
});

describe('formatDateOrNA', () => {
  it('formats valid date', () => {
    expect(formatDateOrNA('1990-10-15')).toBe('Oct 15, 1990');
  });

  it('returns N/A for empty values', () => {
    expect(formatDateOrNA('')).toBe('N/A');
    expect(formatDateOrNA(null)).toBe('N/A');
    expect(formatDateOrNA(undefined)).toBe('N/A');
  });
});
