/**
 * Format a date string (YYYY-MM-DD) for display.
 * Parses the date string directly to avoid UTC timezone conversion issues
 * that can cause off-by-one day errors in US timezones.
 */
export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  try {
    // Parse date string directly to avoid UTC timezone conversion issues
    // new Date("1990-10-15") interprets as UTC midnight, which shifts backward in US timezones
    const [year, month, day] = dateStr.split('-').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return dateStr; // Return original if parsing fails
    }
    const date = new Date(year, month - 1, day); // Local timezone
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format a date string for display, returning 'N/A' for missing values.
 * Used in eligibility results where missing dates should show N/A.
 */
export function formatDateOrNA(dateStr: string | undefined | null): string {
  if (!dateStr) return 'N/A';
  const result = formatDate(dateStr);
  return result || 'N/A';
}
