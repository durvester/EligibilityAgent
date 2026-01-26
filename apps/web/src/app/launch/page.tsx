'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function LaunchContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const iss = searchParams.get('iss');
    const launch = searchParams.get('launch');

    if (!iss || !launch) {
      setError('Missing required launch parameters (iss, launch)');
      return;
    }

    // Redirect to backend to initiate SMART OAuth flow
    const authUrl = new URL('/api/auth/launch', window.location.origin);
    authUrl.searchParams.set('iss', iss);
    authUrl.searchParams.set('launch', launch);

    window.location.href = authUrl.toString();
  }, [searchParams]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="card p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-xl">!</span>
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 mb-2">
            Launch Error
          </h1>
          <p className="text-neutral-600 text-sm">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto" />
        <p className="text-neutral-600">Connecting to EHR...</p>
      </div>
    </main>
  );
}

export default function LaunchPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto" />
          <p className="text-neutral-600">Loading...</p>
        </div>
      </main>
    }>
      <LaunchContent />
    </Suspense>
  );
}
