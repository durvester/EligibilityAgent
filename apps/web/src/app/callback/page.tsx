'use client';

import { Suspense } from 'react';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double processing in React StrictMode
    if (hasProcessed.current) return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      hasProcessed.current = true;
      setError(errorDescription || errorParam);
      setIsProcessing(false);
      return;
    }

    // If no code yet, wait - this can happen during initial render
    if (!code) {
      // Check if we have any params at all - if not, still waiting
      const hasAnyParams = searchParams.toString().length > 0;
      if (!hasAnyParams) {
        // Still waiting for params, don't show error yet
        return;
      }
      hasProcessed.current = true;
      setError('Missing authorization code');
      setIsProcessing(false);
      return;
    }

    hasProcessed.current = true;

    // Exchange code for token via backend
    async function exchangeToken() {
      try {
        const response = await fetch('/api/auth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Token exchange failed');
        }

        // Store token data in sessionStorage for use by eligibility page
        sessionStorage.setItem('smart_access_token', data.access_token);
        sessionStorage.setItem('smart_fhir_base_url', data.fhirBaseUrl);
        if (data.refresh_token) {
          sessionStorage.setItem('smart_refresh_token', data.refresh_token);
        }
        // Store id_token for user identification (contains fhirUser claim)
        if (data.id_token) {
          sessionStorage.setItem('smart_id_token', data.id_token);
        }
        // Store fhirUser if provided directly
        if (data.fhirUser) {
          sessionStorage.setItem('smart_fhir_user', data.fhirUser);
        }

        // Redirect to eligibility page with patient context
        const patientId = data.patient || searchParams.get('patient');
        router.push(`/eligibility${patientId ? `?patient=${patientId}` : ''}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setIsProcessing(false);
      }
    }

    exchangeToken();
  }, [searchParams, router]);

  // Show error only after processing is complete and there's an actual error
  if (!isProcessing && error) {
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

  // Always show loading while processing
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
