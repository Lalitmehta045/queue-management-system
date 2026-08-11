/* eslint-disable */
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import { fetchWithAuth } from '../../../../../lib/auth-client';

type Membership = { organization: { id: string }; branchId: string | null };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Ticket = {
  organization: { name: string };
  branch: { name: string; code: string | null };
  token: { displayNumber: string; businessDate: string; issuedAt: string; status: string };
  department: { name: string };
  service: { name: string };
  counter: { name: string; code: string } | null;
  printedAt: string;
};

function PrintTicketPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const searchParams = useSearchParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [hwPrinterState, setHwPrinterState] = useState<'idle' | 'printing' | 'success' | 'failed' | 'unavailable'>('idle');
  const [hardwarePrinterId, setHardwarePrinterId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string>('');
  const [currentBranchId, setCurrentBranchId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function loadTicket() {
      try {
        const meResponse = await fetchWithAuth('/api/auth/me');
        if (meResponse.status === 401 || !meResponse.ok) {
          if (!cancelled) setState('error');
          return;
        }
        const user = await meResponse.json() as User;
        const membership = user.memberships[0];
        if (!membership) {
          if (!cancelled) setState('error');
          return;
        }
        let branchId = searchParams.get('branch') ?? membership.branchId ?? '';
        if (!branchId) {
          const branchesResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
          if (branchesResponse.ok) {
            const branchList = await branchesResponse.json() as { data: Branch[] };
            branchId = branchList.data[0]?.id ?? '';
          }
        }
        if (!branchId) {
          if (!cancelled) setState('error');
          return;
        }
        const response = await fetchWithAuth(`/api/branches/${branchId}/tokens/${tokenId}/print`, {
          method: 'POST',
          headers: { 'x-organization-id': membership.organization.id },
        });
        if (response.status === 403) {
          if (!cancelled) setState('forbidden');
          return;
        }
        if (!response.ok) {
          if (!cancelled) setState('error');
          return;
        }
        const data = await response.json() as Ticket;
        setOrgId(membership.organization.id);
        setCurrentBranchId(branchId);

        // Check hardware printers
        try {
          const printersRes = await fetchWithAuth(`/api/branches/${branchId}/printers`, {
            headers: { 'x-organization-id': membership.organization.id },
          });
          if (printersRes.ok) {
            const printers = await printersRes.json() as any[];
            const onlinePrinter = printers.find(p => p.status === 'ONLINE');
            if (onlinePrinter) {
              setHardwarePrinterId(onlinePrinter.id);
            }
          }
        } catch (e) {}

        if (!cancelled) {
          setTicket(data);
          setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    }
    void loadTicket();
    return () => { cancelled = true; };
  }, [searchParams, tokenId]);

  useEffect(() => {
    if (state !== 'ready') return;
    if (hardwarePrinterId) {
      // Auto-print to hardware
      handleHardwarePrint();
    } else {
      // Auto fallback to browser
      const timer = window.setTimeout(() => window.print(), 600);
      return () => window.clearTimeout(timer);
    }
  }, [state, hardwarePrinterId]);

  async function handleHardwarePrint() {
    if (!hardwarePrinterId || hwPrinterState === 'printing') return;
    setHwPrinterState('printing');
    try {
      const res = await fetchWithAuth(`/api/branches/${currentBranchId}/printers/${hardwarePrinterId}/print-token/${tokenId}`, {
        method: 'POST',
        headers: {
          'x-organization-id': orgId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idempotencyKey: `print_${tokenId}_${Date.now()}` }) // unique for manual reprint
      });
      if (res.ok) {
        setHwPrinterState('success');
      } else {
        setHwPrinterState('failed');
      }
    } catch {
      setHwPrinterState('failed');
    }
  }

  if (state === 'loading') return <main className="page-shell"><p>Loading ticket...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to print this ticket.</p></main>;
  if (state === 'error' || !ticket) return <main className="page-shell"><p className="error-text">Unable to load ticket data.</p></main>;

  return (
    <main className="page-shell print-shell">
      <div className="print-toolbar">
        <a className="link-button" href="/dashboard/tokens">← Back to tokens</a>
        {hardwarePrinterId && (
          <button type="button" onClick={handleHardwarePrint} disabled={hwPrinterState === 'printing'}>
            {hwPrinterState === 'printing' ? 'Sending to Printer...' : 'Print to Hardware'}
          </button>
        )}
        <button type="button" onClick={() => window.print()} className={hardwarePrinterId ? "secondary-button" : ""}>Browser Print</button>
      </div>
      {hwPrinterState === 'failed' && <p className="error-text">Hardware printing failed. Please check the printer bridge or use Browser Print.</p>}
      {hwPrinterState === 'success' && <p className="success-text" style={{ color: 'green', fontWeight: 'bold', margin: '1rem 0' }}>Job sent to hardware printer!</p>}
      <div className="ticket-sheet" aria-label="Queue ticket">
        <header className="ticket-header">
          <p className="ticket-org">{ticket.organization.name}</p>
          <p className="ticket-branch">{ticket.branch.name}{ticket.branch.code ? ` (${ticket.branch.code})` : ''}</p>
        </header>
        <div className="ticket-token">
          <p className="ticket-kicker">YOUR TOKEN</p>
          <p className="ticket-number">{ticket.token.displayNumber}</p>
        </div>
        <dl className="ticket-fields">
          <div><dt>Service</dt><dd>{ticket.service.name}</dd></div>
          <div><dt>Department</dt><dd>{ticket.department.name}</dd></div>
          <div><dt>Counter</dt><dd>{ticket.counter ? `${ticket.counter.name} (${ticket.counter.code})` : '—'}</dd></div>
          <div><dt>Business date</dt><dd>{ticket.token.businessDate}</dd></div>
          <div><dt>Issued</dt><dd>{new Date(ticket.token.issuedAt).toLocaleString()}</dd></div>
        </dl>
        <div className="ticket-qr" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '4mm 0', padding: '2mm 0', borderTop: '1px dashed #cbd5e1' }}>
          <QRCode value={`${typeof window !== 'undefined' ? window.location.origin : ''}/queue/${tokenId}`} size={96} level="M" />
          <p style={{ margin: '2mm 0 0', fontSize: '10px', textAlign: 'center', fontWeight: 'bold' }}>Scan to check queue status</p>
        </div>
        <p className="ticket-note">Please wait for your token number to be called. Your token remains valid for today&apos;s business date only.</p>
        <p className="ticket-stub">Printed {new Date(ticket.printedAt).toLocaleString()}</p>
      </div>
    </main>
  );
}

export default function PrintTicketRoute() {
  return (
    <Suspense fallback={<main className="page-shell"><p>Loading ticket...</p></main>}>
      <PrintTicketPage />
    </Suspense>
  );
}
