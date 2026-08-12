'use client';

import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import QRCode from 'react-qr-code';
import type { User, Branch, PrintTicket } from '../../../../../types/queue';
import { fetchWithAuth } from '../../../../../lib/auth-client';
import { Button } from '../../../../../components/ui/Button';
import { ErrorState } from '../../../../../components/ui/ErrorState';

type PrinterInfo = { id: string; status: string; name: string };

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

        // Check hardware printers
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
          // gracefully ignore printer fetch failures
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
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 font-medium">Preparing ticket...</p>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-md mx-auto mt-12 p-6">
        <ErrorState title="Access Denied" message="You do not have permission to print this ticket." />
      </div>
    );
  }

  if (state === 'error' || !ticket) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6">
        <ErrorState title="Print Error" message="Unable to load ticket data for printing." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const issuedDate = new Date(ticket.token.issuedAt);
  const dateStr = issuedDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = issuedDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-black font-sans flex flex-col items-center">
      {/* Print Toolbar - Hidden when printing */}
      <div className="print:hidden w-full max-w-md bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <a href="/dashboard/tokens" className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
              &larr; Back to tokens
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
      
      {/* Receipt Canvas */}
      <div className="my-8 print:my-0 print:shadow-none w-full max-w-sm bg-white shadow-xl p-8 print:p-0">
        <div className="receipt-content text-center flex flex-col items-center justify-center">
          
          <div className="mb-6 w-full pb-4 border-b-2 border-dashed border-gray-300">
            <h1 className="text-xl font-bold uppercase tracking-widest">{ticket.organization.name}</h1>
            <p className="text-sm text-gray-600 mt-1 uppercase font-medium">
              {ticket.branch.name}{ticket.branch.code ? ` (${ticket.branch.code})` : ''}
            </p>
          </div>

          <div className="w-full flex justify-between text-xs text-gray-500 font-mono mb-8">
            <span>Date: {dateStr}</span>
            <span>Time: {timeStr}</span>
          </div>

          <div className="mb-2 w-full text-center">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Your Token Number</p>
            <div className="text-[5rem] font-black leading-none tracking-tighter">
              {ticket.token.displayNumber}
            </div>
          </div>

          <div className="my-8 w-full">
            <div className="inline-block px-4 py-2 bg-gray-100 font-bold text-lg rounded-lg border border-gray-200 print:border-gray-400">
              {ticket.service.name}
            </div>
          </div>

          <div className="mt-8 pt-8 border-t-2 border-dashed border-gray-300 w-full flex flex-col items-center">
            <div className="p-2 bg-white rounded-xl shadow-sm border border-gray-100 print:shadow-none print:border-none print:p-0">
              <QRCode value={`${origin}/queue/${tokenId}`} size={120} level="M" />
            </div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-4">
              Scan to check queue status
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
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 font-medium">Loading ticket...</p>
        </div>
      </div>
    }>
      <PrintTicketPage />
    </Suspense>
  );
}
