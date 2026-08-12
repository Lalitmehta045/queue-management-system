'use client';

import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import type { User, Branch, PrintTicket } from '../../../../../types/queue';
import { fetchWithAuth } from '../../../../../lib/auth-client';
import { Button } from '../../../../../components/ui/Button';
import { ErrorState } from '../../../../../components/ui/ErrorState';

type PrinterInfo = { id: string; status: string; name: string };

const systemFont = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", sans-serif'
};

function PrintTicketPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const searchParams = useSearchParams();
  const [ticket, setTicket] = useState<PrintTicket | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [hwPrinterState, setHwPrinterState] = useState<'idle' | 'printing' | 'success' | 'failed' | 'unavailable'>('idle');
  const [hardwarePrinterId, setHardwarePrinterId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string>('');
  const [currentBranchId, setCurrentBranchId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const hasAutoPrinted = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTicket() {
      try {
        const meResponse = await fetchWithAuth('/api/auth/me');
        if (meResponse.status === 401 || !meResponse.ok) {
          if (!cancelled && isMounted.current) setState('error');
          return;
        }
        const user = (await meResponse.json()) as User;
        const membership = user.memberships[0];
        if (!membership) {
          if (!cancelled && isMounted.current) setState('error');
          return;
        }
        
        let branchId = searchParams.get('branch') ?? membership.branchId ?? '';
        if (!branchId) {
          const branchesResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', {
            headers: { 'x-organization-id': membership.organization.id },
          });
          if (branchesResponse.ok) {
            const branchList = (await branchesResponse.json()) as { data: Branch[] };
            branchId = branchList.data[0]?.id ?? '';
          }
        }
        if (!branchId) {
          if (!cancelled && isMounted.current) setState('error');
          return;
        }
        
        const response = await fetchWithAuth(`/api/branches/${branchId}/tokens/${tokenId}/print`, {
          method: 'POST',
          headers: { 'x-organization-id': membership.organization.id },
        });
        
        if (response.status === 403) {
          if (!cancelled && isMounted.current) setState('forbidden');
          return;
        }
        if (!response.ok) {
          if (!cancelled && isMounted.current) setState('error');
          return;
        }
        const data = (await response.json()) as PrintTicket;
        if (cancelled) return;
        
        if (isMounted.current) {
          setOrgId(membership.organization.id);
          setCurrentBranchId(branchId);
        }

        try {
          const printersRes = await fetchWithAuth(`/api/branches/${branchId}/printers`, {
            headers: { 'x-organization-id': membership.organization.id },
          });
          if (printersRes.ok) {
            const printers = (await printersRes.json()) as PrinterInfo[];
            const onlinePrinter = printers.find((p) => p.status === 'ONLINE');
            if (onlinePrinter && isMounted.current) {
              setHardwarePrinterId(onlinePrinter.id);
            }
          }
        } catch {
          // ignore
        }

        if (!cancelled && isMounted.current) {
          setTicket(data);
          setState('ready');
        }
      } catch {
        if (!cancelled && isMounted.current) setState('error');
      }
    }
    void loadTicket();
    return () => {
      cancelled = true;
    };
  }, [searchParams, tokenId]);

  const handleHardwarePrint = useCallback(async () => {
    if (!hardwarePrinterId || isSubmitting) return;
    setHwPrinterState('printing');
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/branches/${currentBranchId}/printers/${hardwarePrinterId}/print-token/${tokenId}`, {
        method: 'POST',
        headers: {
          'x-organization-id': orgId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idempotencyKey: `print_${tokenId}_${Date.now()}` }),
      });
      if (isMounted.current) {
        if (res.ok) {
          setHwPrinterState('success');
        } else {
          setHwPrinterState('failed');
        }
      }
    } catch {
      if (isMounted.current) setHwPrinterState('failed');
    } finally {
      if (isMounted.current) setIsSubmitting(false);
    }
  }, [hardwarePrinterId, isSubmitting, currentBranchId, tokenId, orgId]);

  useEffect(() => {
    if (state !== 'ready' || hasAutoPrinted.current) return;
    
    if (hardwarePrinterId) {
      hasAutoPrinted.current = true;
      void handleHardwarePrint();
    } else {
      hasAutoPrinted.current = true;
      const timer = window.setTimeout(() => window.print(), 600);
      return () => window.clearTimeout(timer);
    }
  }, [state, hardwarePrinterId, handleHardwarePrint]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100" style={systemFont}>
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-slate-800 rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 font-medium">Preparing ticket...</p>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-md mx-auto mt-12 p-6" style={systemFont}>
        <ErrorState title="Access Denied" message="You do not have permission to print this ticket." />
      </div>
    );
  }

  if (state === 'error' || !ticket) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6" style={systemFont}>
        <ErrorState title="Print Error" message="Unable to load ticket data for printing." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const issuedDate = new Date(ticket.token.issuedAt);
  const dateStr = issuedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = issuedDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-black flex flex-col items-center" style={systemFont}>
      <div className="print:hidden w-full max-w-md bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <a href="/dashboard/reception" className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
              &larr; Back to reception
            </a>
            <div className="flex gap-2">
              {hardwarePrinterId && (
                <Button 
                  size="sm" 
                  onClick={() => void handleHardwarePrint()} 
                  disabled={hwPrinterState === 'printing' || isSubmitting}
                  isLoading={hwPrinterState === 'printing' || isSubmitting}
                >
                  Hardware Print
                </Button>
              )}
              <Button 
                size="sm" 
                variant={hardwarePrinterId ? 'outline' : 'primary'}
                onClick={() => window.print()}
              >
                Browser Print
              </Button>
            </div>
          </div>
          
          {hwPrinterState === 'failed' && (
            <div className="p-2 bg-red-50 text-red-700 rounded text-xs font-medium border border-red-200">
              Hardware printing failed. Please use Browser Print.
            </div>
          )}
          {hwPrinterState === 'success' && (
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded text-xs font-medium border border-emerald-200">
              Job sent to hardware printer!
            </div>
          )}
        </div>
      </div>
      
      <div className="my-8 print:my-0 print:shadow-none w-full max-w-sm bg-white shadow-xl p-8 print:p-0 print:w-[80mm] print:mx-auto">
        <div className="receipt-content flex flex-col text-center">
          
          <div className="mb-6 w-full">
            <h1 className="text-xl font-bold uppercase tracking-widest text-black">{ticket.organization.name}</h1>
          </div>

          <div className="w-full flex justify-between text-xs text-black font-medium mb-8 uppercase tracking-wider">
            <span>Date: {dateStr}</span>
            <span>Time: {timeStr}</span>
          </div>

          <div className="mb-8 w-full text-center">
            <div className="text-[6rem] font-black leading-none tracking-tighter text-black">
              {ticket.token.displayNumber}
            </div>
          </div>

          <div className="w-full flex flex-col items-center mb-8">
            <div className="p-1 bg-white">
              <QRCode value={`${origin}/queue/${tokenId}`} size={120} level="M" fgColor="#000000" />
            </div>
          </div>

          <div className="w-full text-center">
            <p className="text-sm font-bold text-black uppercase tracking-widest">
              Please wait for your turn
            </p>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default function PrintTicketRoute() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-100" style={systemFont}>
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-slate-800 rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 font-medium">Loading ticket...</p>
        </div>
      </div>
    }>
      <PrintTicketPage />
    </Suspense>
  );
}
