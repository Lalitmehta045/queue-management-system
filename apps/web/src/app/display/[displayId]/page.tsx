import type { DisplaySnapshot } from '../../../types/queue';
import PublicDisplayClient from './display-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadInitialSnapshot(displayId: string): Promise<{
  snapshot: DisplaySnapshot | null;
  error: boolean;
}> {
  const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  const upstreamUrl = `${apiUrl}/public/displays/${encodeURIComponent(displayId)}`;

  try {
    const response = await fetch(upstreamUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { snapshot: null, error: true };
    const snapshot = (await response.json()) as DisplaySnapshot;
    return { snapshot, error: false };
  } catch {
    return { snapshot: null, error: true };
  }
}

export default async function PublicDisplayPage({
  params,
}: {
  params: Promise<{ displayId: string }>;
}) {
  const { displayId } = await params;
  const { snapshot, error } = await loadInitialSnapshot(displayId);

  return (
    <PublicDisplayClient
      displayId={displayId}
      initialSnapshot={snapshot}
      initialError={error}
    />
  );
}
