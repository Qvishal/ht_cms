"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

export default function DashboardIndexPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("/tables")
      .then((res) => {
        const first = (res.tables ?? [])[0];
        router.replace(first ? `/dashboard/${first}` : "/setup");
      })
      .finally(() => setLoading(false));
  }, [router]);

  return loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null;
}

