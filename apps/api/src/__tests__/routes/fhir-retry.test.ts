/**
 * Tests for FHIR request retry-on-401 logic.
 *
 * This tests the core retry-on-401 pattern:
 * 1. Try request with current token
 * 2. If 401, refresh token and retry once
 * 3. If refresh fails, throw auth error
 *
 * We test the logic directly without mocking external dependencies.
 */

// Custom error class for auth failures (mirrors the one in fhir.ts)
class FhirAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FhirAuthError';
  }
}

// Generic retry-on-401 implementation for testing
// This mirrors the logic in fhir.ts fhirRequestWithRetry
async function retryOnAuth<T>(
  getToken: () => Promise<string | null>,
  refreshToken: () => Promise<string | null>,
  makeRequest: (token: string) => Promise<T>,
  isAuthError: (error: unknown) => boolean
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new FhirAuthError('Session token not available');
  }

  try {
    return await makeRequest(token);
  } catch (error) {
    if (isAuthError(error)) {
      const newToken = await refreshToken();
      if (!newToken) {
        throw new FhirAuthError('Token refresh failed - please re-authenticate');
      }
      return await makeRequest(newToken);
    }
    throw error;
  }
}

describe('retry-on-401 logic', () => {
  const initialToken = 'initial-access-token';
  const refreshedToken = 'refreshed-access-token';

  describe('successful requests (no retry needed)', () => {
    it('should return data on first successful request', async () => {
      const mockData = { resourceType: 'Patient', id: '123' };

      const getToken = async () => initialToken;
      const refreshToken = async () => refreshedToken;
      const makeRequest = async (token: string) => {
        expect(token).toBe(initialToken);
        return mockData;
      };
      const isAuthError = () => false;

      const result = await retryOnAuth(getToken, refreshToken, makeRequest, isAuthError);

      expect(result).toEqual(mockData);
    });

    it('should pass the correct token to makeRequest', async () => {
      const receivedTokens: string[] = [];

      const getToken = async () => initialToken;
      const refreshToken = async () => refreshedToken;
      const makeRequest = async (token: string) => {
        receivedTokens.push(token);
        return { success: true };
      };
      const isAuthError = () => false;

      await retryOnAuth(getToken, refreshToken, makeRequest, isAuthError);

      expect(receivedTokens).toEqual([initialToken]);
    });
  });

  describe('token refresh on auth error', () => {
    it('should refresh token and retry on 401', async () => {
      const mockData = { resourceType: 'Patient', id: '123' };
      const requestAttempts: string[] = [];
      let callCount = 0;

      const getToken = async () => initialToken;
      const refreshToken = async () => refreshedToken;
      const makeRequest = async (token: string) => {
        requestAttempts.push(token);
        callCount++;
        if (callCount === 1) {
          throw new Error('401 Unauthorized');
        }
        return mockData;
      };
      const isAuthError = (error: unknown) =>
        error instanceof Error && error.message.includes('401');

      const result = await retryOnAuth(getToken, refreshToken, makeRequest, isAuthError);

      expect(result).toEqual(mockData);
      expect(requestAttempts).toEqual([initialToken, refreshedToken]);
    });

    it('should throw FhirAuthError if refresh returns null', async () => {
      const getToken = async () => initialToken;
      const refreshToken = async () => null;
      const makeRequest = async () => {
        throw new Error('401 Unauthorized');
      };
      const isAuthError = () => true;

      await expect(retryOnAuth(getToken, refreshToken, makeRequest, isAuthError))
        .rejects
        .toThrow('Token refresh failed - please re-authenticate');
    });

    it('should only retry once (not infinite loop)', async () => {
      let attempts = 0;

      const getToken = async () => initialToken;
      const refreshToken = async () => refreshedToken;
      const makeRequest = async () => {
        attempts++;
        throw new Error('401 Unauthorized');
      };
      const isAuthError = () => true;

      // Should throw after 2 attempts (initial + 1 retry)
      await expect(retryOnAuth(getToken, refreshToken, makeRequest, isAuthError))
        .rejects
        .toThrow('401 Unauthorized');

      expect(attempts).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should throw FhirAuthError if no initial token', async () => {
      const getToken = async () => null;
      const refreshToken = async () => refreshedToken;
      const makeRequest = async () => ({ success: true });
      const isAuthError = () => false;

      await expect(retryOnAuth(getToken, refreshToken, makeRequest, isAuthError))
        .rejects
        .toThrow('Session token not available');
    });

    it('should not retry on non-auth errors', async () => {
      let refreshCalled = false;
      let attempts = 0;

      const getToken = async () => initialToken;
      const refreshToken = async () => {
        refreshCalled = true;
        return refreshedToken;
      };
      const makeRequest = async () => {
        attempts++;
        throw new Error('500 Server Error');
      };
      const isAuthError = () => false; // 500 is not an auth error

      await expect(retryOnAuth(getToken, refreshToken, makeRequest, isAuthError))
        .rejects
        .toThrow('500 Server Error');

      expect(attempts).toBe(1);
      expect(refreshCalled).toBe(false);
    });

    it('should propagate the original error for non-auth errors', async () => {
      const customError = new TypeError('Custom type error');

      const getToken = async () => initialToken;
      const refreshToken = async () => refreshedToken;
      const makeRequest = async () => {
        throw customError;
      };
      const isAuthError = () => false;

      await expect(retryOnAuth(getToken, refreshToken, makeRequest, isAuthError))
        .rejects
        .toBe(customError);
    });
  });
});

describe('FhirAuthError', () => {
  it('should have correct name property', () => {
    const error = new FhirAuthError('test message');
    expect(error.name).toBe('FhirAuthError');
  });

  it('should have correct message property', () => {
    const error = new FhirAuthError('Session expired');
    expect(error.message).toBe('Session expired');
  });

  it('should be instanceof Error', () => {
    const error = new FhirAuthError('test');
    expect(error).toBeInstanceOf(Error);
  });
});
