import { proxyRequest } from '../../proxy';

export async function POST(request: Request) {
  return proxyRequest(request, '/auth/logout');
}
