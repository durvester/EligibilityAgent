'use client';

import { Suspense } from 'react';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * OAuth Callback Page
 *
 * This page receives the OAuth callback from the authorization server,
 * then REDIRECTS the browser to the API to complete the flow.
 *
 * Why redirect instead of fetch?
 * - The API sets an HTTP-only cookie directly on the browser
 * - No proxy cookie forwarding issues
 * - Cookie domain can be set to work across subdomains
 * - Simpler, more reliable, standards-compliant OAuth flow
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double processing in React StrictMode
    if (hasProcessed.current) return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Handle OAuth error response
    if (errorParam) {
      hasProcessed.current = true;
      setError(errorDescription || errorParam);
      return;
    }

    // If no code yet, wait - this can happen during initial render
    if (!code) {
      const hasAnyParams = searchParams.toString().length > 0;
      if (!hasAnyParams) {
        // Still waiting for params, don't show error yet
        return;
      }
      hasProcessed.current = true;
      setError('Missing authorization code');
      return;
    }

    hasProcessed.current = true;

    // REDIRECT browser to API to complete OAuth flow
    // API will:
    // 1. Exchange code for tokens
    // 2. Create session
    // 3. Set HTTP-only cookie DIRECTLY on browser
    // 4. Redirect back to /eligibility
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      setError('Configuration error: API URL not set');
      return;
    }

    // Build redirect URL with code and state
    const callbackUrl = new URL(`${apiUrl}/auth/callback`);
    callbackUrl.searchParams.set('code', code);
    if (state) {
      callbackUrl.searchParams.set('state', state);
    }

    // Redirect browser to API
    window.location.href = callbackUrl.toString();
  }, [searchParams]);

  // Show error if OAuth failed
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="card p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-xl">!</span>
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 mb-2">
            Authentication Error
          </h1>
          <p className="text-neutral-600 text-sm">{error}</p>
          <button
            onClick={() => window.close()}
            className="btn btn-secondary mt-6"
          >
            Close
          </button>
        </div>
      </main>
    );
  }

  // Show loading while redirecting
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto" />
        <p className="text-neutral-600">Completing authentication...</p>
      </div>
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto" />
          <p className="text-neutral-600">Loading...</p>
        </div>
      </main>
    }>
      <CallbackContent />
    </Suspense>
  );
}
