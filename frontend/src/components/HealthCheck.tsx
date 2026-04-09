"use client";

import { useEffect, useRef, useState } from "react";

export default function HealthCheck() {
  const [status, setStatus] = useState<"checking" | "ok" | "down">("checking");
  const intervalRef = useRef<number | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const pollMs = Number(process.env.NEXT_PUBLIC_HEALTH_POLL_MS ?? 5000);

  async function check() {
    try {
      // Use server-side proxy so CORS/auth isn't an issue from the client
      const res = await fetch(`/api/health`, { cache: "no-store" });
      if (!res.ok) throw new Error("health not ok");
      const json = await res.json();
      if (json && json.db === "ok") setStatus("ok");
      else setStatus("down");
    } catch (e) {
      setStatus("down");
    }
  }

  useEffect(() => {
    check();
    intervalRef.current = window.setInterval(check, Math.max(1000, pollMs));
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [pollMs]);

  if (status === "checking" || status === "ok") return null;

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
      <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 px-4 py-2 rounded shadow flex gap-3 items-center">
        <span>Backend database unreachable — some features may be offline.</span>
        <button
          onClick={check}
          className="px-2 py-1 bg-yellow-600 text-white rounded"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
