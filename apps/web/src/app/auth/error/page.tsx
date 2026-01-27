'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code') || 'UNKNOWN_ERROR';
  const message = searchParams.get('message') || 'An authentication error occurred.';

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-neutral-50">
      <div className="bg-white rounded-lg shadow-sm border border-neutral-200 p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-red-600" />
        </div>
        <h1 className="text-xl font-semibold text-neutral-900 mb-2">
          Authentication Failed
        </h1>
        <p className="text-neutral-600 text-sm mb-4">{message}</p>
        <p className="text-neutral-400 text-xs font-mono mb-6">Error: {code}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => window.close()}
            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            Close Window
          </button>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-8 bg-neutral-50">
        <div className="text-neutral-600">Loading...</div>
      </main>
    }>
      <AuthErrorContent />
    </Suspense>
  );
}
