'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function QrScanPage() {
  const [payload, setPayload] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Keep input focused for hardware scanner
  useEffect(() => {
    const focusInput = () => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    };
    
    focusInput();
    document.addEventListener('click', focusInput);
    return () => document.removeEventListener('click', focusInput);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload.trim()) return;
    
    if (!payload.startsWith('QMS:1:')) {
      setError('Invalid QR code format. Please try again.');
      setPayload('');
      return;
    }

    const encoded = encodeURIComponent(btoa(payload));
    router.push(`/self-service/check-in/${encoded}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-gray-900">
      <div className="max-w-md w-full bg-white shadow-xl rounded-2xl p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
        </div>
        
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Welcome</h1>
        <p className="text-gray-500">Please scan your Appointment or Token QR code to proceed.</p>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8">
          {/* Invisible input to capture hardware scanner keystrokes */}
          <input
            ref={inputRef}
            type="text"
            className="opacity-0 absolute -z-10 h-0 w-0"
            value={payload}
            onChange={(e) => {
              setError(null);
              setPayload(e.target.value);
            }}
            placeholder="Scanning..."
            autoComplete="off"
            autoFocus
          />
          
          <div className="animate-pulse flex space-x-2 items-center justify-center text-blue-600">
            <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
            <div className="w-3 h-3 bg-blue-600 rounded-full animation-delay-200"></div>
            <div className="w-3 h-3 bg-blue-600 rounded-full animation-delay-400"></div>
          </div>
          <p className="text-sm font-medium mt-4 text-blue-600">Scanner Ready</p>
        </form>
      </div>
    </div>
  );
}
