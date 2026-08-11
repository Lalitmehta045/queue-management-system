'use client';

/**
 * Root error boundary (App Router). Rendered ONLY when an uncaught error
 * bubbles past the nearest error boundary — it replaces the root layout, so
 * it must provide its own <html> and <body> and must not depend on any
 * layout-level context providers.
 *
 * An explicit file also fixes Next.js 16 failing to statically prerender the
 * internal /_global-error route.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="page-shell">
          <section className="content-panel">
            <p className="eyebrow">Something went wrong</p>
            <h1>Application error</h1>
            <p className="muted">{error.message}</p>
            <button onClick={() => reset()}>Try again</button>
          </section>
        </div>
      </body>
    </html>
  );
}
