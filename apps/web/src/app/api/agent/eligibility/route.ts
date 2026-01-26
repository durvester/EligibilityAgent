import { proxySSE } from '../../proxy';

export async function POST(request: Request) {
  return proxySSE(request, '/agent/eligibility');
}
