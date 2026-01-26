import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">
            Eligibility Agent
          </h1>
          <p className="mt-2 text-neutral-600">
            SMART on FHIR Insurance Eligibility Verification
          </p>
        </div>

        <div className="card p-6 space-y-4">
          <p className="text-sm text-neutral-500">
            This application is designed to be launched from an EHR system via
            SMART on FHIR. If you&apos;re seeing this page, you may need to launch
            the app from your EHR.
          </p>

          <div className="pt-4 border-t border-neutral-100">
            <p className="text-xs text-neutral-400 mb-3">Development Links</p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/launch?iss=https://fhir.example.com/r4&launch=test123"
                className="btn btn-secondary text-xs"
              >
                Test Launch
              </Link>
              <Link
                href="/eligibility?patient=test-patient-id"
                className="btn btn-primary text-xs"
              >
                Test Eligibility
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
