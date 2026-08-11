import type { Metadata } from 'next';
import QueueStatusClient from './QueueStatusClient';

export const metadata: Metadata = {
  title: 'Queue Status | Smart Queue',
  description: 'Check your real-time queue position and estimated wait time. No login required.',
  robots: { index: false, follow: false },
};

export default function QueueStatusPage({ params }: { params: Promise<{ publicTokenId: string }> }) {
  return <QueueStatusClient params={params} />;
}
