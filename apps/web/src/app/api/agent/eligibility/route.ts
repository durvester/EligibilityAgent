import { proxySSE } from '../../proxy';

// Enable streaming for this route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return proxySSE(request, '/agent/eligibility');
}
