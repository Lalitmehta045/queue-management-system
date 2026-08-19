'use client';

import { Suspense, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import type { User, Branch, PrintTicket } from '../../../../types/queue';
import { fetchWithAuth } from '../../../../lib/auth-client';
import { Button } from '../../../../components/ui/Button';
import { ErrorState } from '../../../../components/ui/ErrorState';

type PrinterInfo = { id: string; status: string; name: string };

const systemFont = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", sans-serif'
};

function BulkPrintTicketPage() {
  const searchParams = useSearchParams();
  const tokenIdsParam = searchParams.get('tokenIds');
  const tokenIds = useMemo(() => tokenIdsParam ? tokenIdsParam.split(',') : [], [tokenIdsParam]);
  
  const [tickets, setTickets] = useState<PrintTicket[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [hwPrinterState, setHwPrinterState] = useState<'idle' | 'printing' | 'success' | 'failed' | 'unavailable'>('idle');
  const [hardwarePrinterId, setHardwarePrinterId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string>('');
  const [currentBranchId, setCurrentBranchId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [printerWidth, setPrinterWidth] = useState<'80mm' | '58mm'>('80mm');
  
  const hasAutoPrinted = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTickets() {
      if (!tokenIds.length) {
        if (!cancelled && isMounted.current) setState('error');
        return;
      }

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

        const loadedTickets: PrintTicket[] = [];

        for (const id of tokenIds) {
          const response = await fetchWithAuth(`/api/branches/${branchId}/tokens/${id}/print`, {
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
          loadedTickets.push(data);
        }

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
          setTickets(loadedTickets);
          setState('ready');
        }
      } catch {
        if (!cancelled && isMounted.current) setState('error');
      }
    }
    void loadTickets();
    return () => {
      cancelled = true;
    };
  }, [searchParams, tokenIds]);

  const handleHardwarePrint = useCallback(async () => {
    if (!hardwarePrinterId || isSubmitting) return;
    setHwPrinterState('printing');
    setIsSubmitting(true);
    try {
      for (const id of tokenIds) {
        const res = await fetchWithAuth(`/api/branches/${currentBranchId}/printers/${hardwarePrinterId}/print-token/${id}`, {
          method: 'POST',
          headers: {
            'x-organization-id': orgId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ idempotencyKey: `print_${id}_${Date.now()}` }),
        });
        if (!res.ok) {
          if (isMounted.current) setHwPrinterState('failed');
          setIsSubmitting(false);
          return;
        }
      }
      if (isMounted.current) {
        setHwPrinterState('success');
      }
    } catch {
      if (isMounted.current) setHwPrinterState('failed');
    } finally {
      if (isMounted.current) setIsSubmitting(false);
    }
  }, [hardwarePrinterId, isSubmitting, currentBranchId, tokenIds, orgId]);

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
          <p className="mt-4 text-slate-500 font-medium">Preparing {tokenIds.length > 1 ? 'tickets' : 'ticket'}...</p>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-md mx-auto mt-12 p-6" style={systemFont}>
        <ErrorState title="Access Denied" message="You do not have permission to print these tickets." />
      </div>
    );
  }

  if (state === 'error' || !tickets.length) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6" style={systemFont}>
        <ErrorState title="Print Error" message="Unable to load ticket data for printing." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-black flex flex-col items-center" style={systemFont}>
      <div className="print:hidden w-full max-w-md bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <a href="/dashboard/reception" className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
              &larr; Back to reception
            </a>
            <div className="flex gap-2 items-center">
              <select
                value={printerWidth}
                onChange={(e) => setPrinterWidth(e.target.value as '80mm' | '58mm')}
                className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-700 font-medium cursor-pointer"
                title="Select thermal paper size"
              >
                <option value="80mm">80mm Paper</option>
                <option value="58mm">58mm Paper</option>
              </select>
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
          
          <div className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded border border-slate-200">
            <strong>Note:</strong> Set your printer driver to the correct paper size (58mm or 80mm). 
            If the browser preview shows A4, adjust the Paper Size in the print dialog.
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
      
      <style dangerouslySetInnerHTML={{ __html: `
        @media screen {
          .ticket-container {
            width: ${printerWidth};
            margin: 2rem auto;
            background: white;
            padding: ${printerWidth === '58mm' ? '3mm' : '5mm'};
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          }
        }
        @media print {
          @page {
            size: auto;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background-color: white !important;
          }
          .ticket-container {
            display: block !important;
            visibility: visible !important;
            position: relative !important;
            width: ${printerWidth} !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: ${printerWidth === '58mm' ? '3mm' : '5mm'} !important;
            box-sizing: border-box !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            overflow: visible !important;
            box-shadow: none !important;
          }
          /* Ensure the last ticket does not generate a blank page */
          .ticket-container:last-of-type {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          * {
            box-sizing: border-box !important;
          }
        }
      `}} />
      
      <div id="print-root" className="w-full flex flex-col justify-start items-center">
        {tickets.map((ticket, index) => {
          const issuedDate = new Date(ticket.token.issuedAt);
          const dateStr = issuedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          const timeStr = issuedDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={index} className="ticket-container flex flex-col text-center">
              
              <div className="w-full">
                <h1 className={`${printerWidth === '58mm' ? 'text-sm' : 'text-lg'} font-bold uppercase text-black break-words leading-tight m-0`}>
                  {ticket.organization.name}
                </h1>
              </div>

              <div className={`w-full flex justify-between ${printerWidth === '58mm' ? 'text-[10px]' : 'text-xs'} text-black font-medium mt-1 mb-2 uppercase`}>
                <span>{dateStr}</span>
                <span>{timeStr}</span>
              </div>

              <div className="w-full text-center my-2">
                <div className={`${printerWidth === '58mm' ? 'text-4xl' : 'text-6xl'} font-black leading-none tracking-tighter text-black break-words m-0`}>
                  {ticket.token.displayNumber}
                </div>
              </div>

              <div className="w-full text-center mt-2">
                <p className={`${printerWidth === '58mm' ? 'text-[10px]' : 'text-sm'} font-bold text-black uppercase m-0`}>
                  Please wait for your turn
                </p>
              </div>
              
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BulkPrintTicketRoute() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-100" style={systemFont}>
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-slate-300 border-t-slate-800 rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 font-medium">Loading tickets...</p>
        </div>
      </div>
    }>
      <BulkPrintTicketPage />
    </Suspense>
  );
}
