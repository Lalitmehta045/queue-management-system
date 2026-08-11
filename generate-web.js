const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'apps', 'web', 'src');

const dirs = [
  'lib',
  'app/login',
  'app/register',
  'app/dashboard'
];

dirs.forEach(d => {
  const dirPath = path.join(baseDir, d);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

const files = {
  'lib/auth-client.ts': `
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  // Base configuration to include credentials
  const defaultOptions: RequestInit = {
    credentials: 'true' === 'true' ? 'include' : 'include', // just forcing include
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  
  const response = await fetch(url, { ...defaultOptions, ...options });
  
  if (response.status === 401) {
    // If unauthorized, attempt to refresh once
    if (url !== '/api/auth/refresh' && url !== '/api/auth/login') {
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refreshRes.ok) {
        // Retry the original request
        return fetch(url, { ...defaultOptions, ...options });
      } else {
        // Refresh failed, redirect to login
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }
  }
  
  return response;
}
`,
  'app/login/page.tsx': `
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push('/dashboard');
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      setError('An error occurred');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <form onSubmit={handleLogin} className="p-8 bg-gray-800 rounded-lg shadow-xl w-96">
        <h2 className="text-2xl font-bold mb-6 text-center text-blue-400">Sign In</h2>
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <div className="mb-4">
          <label className="block mb-2">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none" required />
        </div>
        <div className="mb-6">
          <label className="block mb-2">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none" required />
        </div>
        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded font-bold transition-colors">Login</button>
        <p className="mt-4 text-center text-sm text-gray-400">
          Don't have an account? <a href="/register" className="text-blue-400 hover:underline">Register</a>
        </p>
      </form>
    </div>
  );
}
`,
  'app/register/page.tsx': `
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });
      if (res.ok) {
        router.push('/dashboard');
      } else {
        setError('Registration failed');
      }
    } catch (err) {
      setError('An error occurred');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <form onSubmit={handleRegister} className="p-8 bg-gray-800 rounded-lg shadow-xl w-96">
        <h2 className="text-2xl font-bold mb-6 text-center text-blue-400">Register</h2>
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <div className="mb-4">
          <label className="block mb-2">Display Name</label>
          <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none" required />
        </div>
        <div className="mb-4">
          <label className="block mb-2">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none" required />
        </div>
        <div className="mb-6">
          <label className="block mb-2">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 outline-none" required />
        </div>
        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded font-bold transition-colors">Sign Up</button>
        <p className="mt-4 text-center text-sm text-gray-400">
          Already have an account? <a href="/login" className="text-blue-400 hover:underline">Login</a>
        </p>
      </form>
    </div>
  );
}
`,
  'app/dashboard/page.tsx': `
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../lib/auth-client';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchWithAuth('/api/auth/me')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Unauthorized');
      })
      .then(data => {
        setUser(data);
        setLoading(false);
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  const handleLogout = async () => {
    await fetchWithAuth('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-blue-400">Dashboard</h1>
          <button onClick={handleLogout} className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded font-bold transition-colors">Logout</button>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Welcome, {user?.displayName}</h2>
          <p className="text-gray-400 mb-6">Email: {user?.email}</p>
          <h3 className="text-lg font-semibold mb-2 text-blue-300">Your Organizations</h3>
          <ul className="space-y-2">
            {user?.memberships?.map((m: any) => (
              <li key={m.id} className="bg-gray-700 p-3 rounded flex justify-between">
                <span>{m.organization.name}</span>
                <span className="text-sm text-gray-400 bg-gray-800 px-2 py-1 rounded">{m.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
`
};

for (const [filename, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(baseDir, filename), content);
}

console.log("Web frontend files generated.");
