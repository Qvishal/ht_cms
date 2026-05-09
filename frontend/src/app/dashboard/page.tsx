"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useSafeReplace } from "@/lib/safe-router";

export default function DashboardIndexPage() {
  const safeReplace = useSafeReplace();
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    Promise.all([apiGet("/me"), apiGet("/tables")])
      .then(([m, t]) => {
        const first = (t.tables ?? [])[0];
        if (first) {
          safeReplace(`/dashboard/${first}`);
          return;
        }
        if (m?.user?.role === "admin") safeReplace("/setup");
        else setEmpty(true);
      })
      .finally(() => setLoading(false));
  }, [safeReplace]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (empty) return <div className="text-sm text-muted-foreground">No tables assigned yet.</div>;
  return null;
}
