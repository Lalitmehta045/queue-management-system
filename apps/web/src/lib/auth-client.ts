
export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  // Base configuration to include credentials
  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  
  const mergedOptions = { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...options.headers } };
  const response = await fetch(url, mergedOptions);
  
  if (response.status === 401) {
    // If unauthorized, attempt to refresh once
    if (url !== '/api/auth/refresh' && url !== '/api/auth/login') {
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refreshRes.ok) {
        // Retry the original request
        return fetch(url, mergedOptions);
      } else {
        // Refresh failed, redirect to login
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        throw new Error('Session expired');
      }
    }
  }
  
  return response;
}

