'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface QrData {
  type: 'TOKEN' | 'APPOINTMENT';
  data: {
    publicTokenId?: string;
    appointmentId?: string;
    patientInitials?: string;
    serviceName?: string;
    branchName?: string;
    date?: string;
    time?: string;
    status?: string;
  };
}

interface CheckInResult {
  publicTokenId: string;
  displayNumber: string;
  serviceName: string;
  patientInitials: string;
}

export default function CheckInPage({ params }: { params: Promise<{ qrId: string }> }) {
  const router = useRouter();
  const { qrId } = use(params);
  
  const [payload, setPayload] = useState<string>('');
  const [validating, setValidating] = useState(true);
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [checkingIn, setCheckingIn] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);

  useEffect(() => {
    const validatePayload = async (qrPayload: string) => {
      try {
        const res = await fetch('/api/public/self-service/qr/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qrPayload })
        });
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.message || 'Failed to validate QR code');
        }

        if (data.type === 'TOKEN' && data.data?.publicTokenId) {
          router.replace(`/queue/${data.data.publicTokenId}`);
          return;
        }

        if (data.data?.status === 'CHECKED_IN') {
          setError('This appointment has already been checked in.');
        } else if (data.data?.status === 'CANCELLED') {
          setError('This appointment has been cancelled.');
        } else {
          setQrData(data);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setValidating(false);
      }
    };

    try {
      const decoded = atob(decodeURIComponent(qrId));
      setPayload(decoded);
      validatePayload(decoded);
    } catch {
      setError('Invalid QR Code');
      setValidating(false);
    }
  }, [qrId, router]);

  const handleCheckIn = async () => {
    setCheckingIn(true);
    setError(null);
    try {
      const res = await fetch('/api/public/self-service/qr/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload: payload })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || 'Failed to check in');
      }
      
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setCheckingIn(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-900">
        <div className="text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
          <p className="font-medium text-gray-600">Validating QR Code...</p>
        </div>
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-900">
        <div className="max-w-md w-full bg-white shadow-xl rounded-2xl p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Invalid QR</h2>
          <p className="text-red-600 font-medium">{error}</p>
          <button
            onClick={() => router.push('/self-service/qr')}
            className="mt-6 w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium rounded-xl transition-colors"
          >
            Scan Again
          </button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-900">
        <div className="max-w-md w-full bg-white shadow-2xl rounded-3xl p-8 text-center space-y-8 border-t-4 border-green-500">
          <div>
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900 mb-2">You&apos;re checked in!</h2>
            <p className="text-gray-500 font-medium">Please wait for your number to be called.</p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 shadow-inner">
            <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Your Token Number</p>
            <div className="text-5xl font-black text-blue-700 tracking-tight">{result.displayNumber}</div>
            
            <div className="mt-6 flex justify-between text-sm items-center border-t border-gray-200 pt-4">
              <span className="text-gray-500">Service</span>
              <span className="font-semibold text-gray-900">{result.serviceName}</span>
            </div>
          </div>

          <Link
            href={`/queue/${result.publicTokenId}`}
            className="block w-full py-4 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-md hover:shadow-lg"
          >
            Track Live Queue Status
          </Link>
        </div>
      </div>
    );
  }

  if (qrData?.type === 'APPOINTMENT') {
    const d = qrData.data;
    const appointmentDate = new Date(d.date!);
    const timeStr = new Date(d.time!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-gray-900">
        <div className="max-w-md w-full bg-white shadow-xl rounded-2xl p-8 space-y-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirm Check-in</h2>
            <p className="text-gray-500">Please review your appointment details.</p>
          </div>

          <div className="bg-blue-50/50 rounded-2xl p-6 space-y-4 border border-blue-100">
            <div className="flex justify-between items-center border-b border-blue-100/50 pb-4">
              <span className="text-gray-500 text-sm font-medium">Patient</span>
              <span className="font-bold text-gray-900 bg-blue-100 px-3 py-1 rounded-full text-sm">
                {d.patientInitials}
              </span>
            </div>
            
            <div className="flex justify-between items-center border-b border-blue-100/50 pb-4">
              <span className="text-gray-500 text-sm font-medium">Service</span>
              <span className="font-semibold text-gray-900">{d.serviceName}</span>
            </div>

            <div className="flex justify-between items-center border-b border-blue-100/50 pb-4">
              <span className="text-gray-500 text-sm font-medium">Date</span>
              <span className="font-semibold text-gray-900">{appointmentDate.toLocaleDateString()}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm font-medium">Time</span>
              <span className="font-semibold text-gray-900">{timeStr}</span>
            </div>
          </div>

          {error && (
             <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium text-center">
               {error}
             </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              onClick={() => router.push('/self-service/qr')}
              className="flex-1 py-4 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
              disabled={checkingIn}
            >
              Cancel
            </button>
            <button
              onClick={handleCheckIn}
              disabled={checkingIn}
              className="flex-[2] py-4 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-md flex items-center justify-center"
            >
              {checkingIn ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Check In Now'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
