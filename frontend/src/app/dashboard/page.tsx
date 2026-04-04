"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

export default function DashboardIndexPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    Promise.all([apiGet("/me"), apiGet("/tables")])
      .then(([m, t]) => {
        const first = (t.tables ?? [])[0];
        if (first) {
          router.replace(`/dashboard/${first}`);
          return;
        }
        if (m?.user?.role === "admin") router.replace("/setup");
        else setEmpty(true);
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (empty) return <div className="text-sm text-muted-foreground">No tables assigned yet.</div>;
  return null;
}
