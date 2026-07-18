'use client';

import { useEffect } from 'react';

/**
 * Global error boundary — catches errors that escape the root layout.
 *
 * Without this, an uncaught render error in the Tauri static export leaves a
 * blank white window with no way to recover. This surfaces the error and lets
 * the booth attendant reload without restarting the whole app.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the devtools console / any log capture.
    console.error('[GlobalError] Uncaught application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#0b0b0f',
          color: '#f5f5f7',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}>
            The app hit an unexpected error
          </h1>
          <p style={{ fontSize: 14, opacity: 0.75, margin: '0 0 20px', lineHeight: 1.5 }}>
            You can reload to get back to the booth. If this keeps happening,
            note the message below and send it to support.
          </p>
          <pre
            style={{
              textAlign: 'left',
              fontSize: 12,
              background: '#17171d',
              border: '1px solid #2a2a33',
              borderRadius: 8,
              padding: 12,
              overflow: 'auto',
              maxHeight: 160,
              marginBottom: 20,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error?.message || 'Unknown error'}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => reset()}
              style={{
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
              style={{
                background: 'transparent',
                color: '#f5f5f7',
                border: '1px solid #3a3a45',
                borderRadius: 8,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload app
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
