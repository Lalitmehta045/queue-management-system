import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streaming SSE proxy so the public display EventSource path does not rely on
 * Next.js rewrites (which can buffer long-lived text/event-stream responses).
 * Also emits X-Accel-Buffering: no so Nginx disables response buffering on this hop.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ displayId: string }> },
) {
  const { displayId } = await context.params;
  const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const upstreamUrl = `${apiUrl}/public/displays/${encodeURIComponent(displayId)}/events`;

  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(realIp ? { 'x-real-ip': realIp } : {}),
      },
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream SSE unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.body) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
