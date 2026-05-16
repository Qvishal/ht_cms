"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function OfflinePage() {
  const [status, setStatus] = useState<"checking" | "ok" | "down">("checking");
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const enableDetailed =
    process.env.NEXT_PUBLIC_ENABLE_DETAILED_OFFLINE === "true" || false;
  const showDetailed = isLocal || enableDetailed;

  async function check() {
    setStatus("checking");
    try {
      const res = await fetch(`${apiBase}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error("not ok");
      const json = await res.json();
      if (json && json.db === "ok") setStatus("ok");
      else setStatus("down");
    } catch (e) {
      setStatus("down");
    }
  }

  useEffect(() => {
    if (isLocal) check();
    // only run check on client/local dev
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocal]);

  // In production (non-localhost and not explicitly enabled) show a generic 500-like page
  if (!showDetailed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-xl p-8 bg-white rounded shadow text-center">
          <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-600 mb-6">A server error occurred (500). Please try again later.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-xl p-8 bg-white rounded shadow text-center">
        <h1 className="text-2xl font-semibold mb-2">Database Unavailable</h1>
        <p className="text-sm text-slate-600 mb-6">
          The application cannot reach the database right now. Some features may be
          unavailable.
        </p>

        {status === "checking" && <p className="mb-4">Checking connection…</p>}
        {status === "down" && (
          <>
            <p className="text-red-600 mb-4">Failed to connect to the backend database.</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={check}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Retry
              </button>
              <Link href="/" className="px-4 py-2 border rounded">
                Home
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              If this persists, try restarting the backend or checking the database
              container.
            </p>
          </>
        )}

        {status === "ok" && (
          <>
            <p className="text-green-600 mb-4">Connection looks healthy.</p>
            <div className="flex gap-3 justify-center">
              <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded">
                Go to App
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
