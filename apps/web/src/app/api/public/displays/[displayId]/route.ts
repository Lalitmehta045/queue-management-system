import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Explicit JSON proxy for public display snapshots so TV clients do not depend
 * solely on Next.js rewrites (which can be shadowed by nearby App Router folders).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ displayId: string }> },
) {
  const { displayId } = await context.params;
  const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  const upstreamUrl = `${apiUrl}/public/displays/${encodeURIComponent(displayId)}`;

  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
        ...(realIp ? { 'x-real-ip': realIp } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream display unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
