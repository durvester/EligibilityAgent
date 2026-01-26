import { proxyRequest } from '../../proxy';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyRequest(request, `/auth/launch${url.search}`);
}
