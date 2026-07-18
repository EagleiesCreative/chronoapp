'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary for the main booth page.
 *
 * Catches render/runtime errors inside the page tree so a single failing
 * component (camera, compositing, payment polling, etc.) shows a recoverable
 * message instead of blanking the whole screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[BoothError] Uncaught error in booth page:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="max-w-md text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          The booth ran into an error. Reload to continue — your admin settings
          are safe.
        </p>
        <pre className="text-left text-xs bg-gray-100 border rounded-lg p-3 overflow-auto max-h-40 mb-5 whitespace-pre-wrap break-words">
          {error?.message || 'Unknown error'}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="bg-primary text-white rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Try again
          </button>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') window.location.reload();
            }}
            className="border rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Reload app
          </button>
        </div>
      </div>
    </div>
  );
}
