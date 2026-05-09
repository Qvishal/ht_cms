"use client";

import { useEffect } from "react";
import { getToken } from "@/lib/auth";
import { useSafeReplace } from "@/lib/safe-router";

export default function HomePage() {
  const safeReplace = useSafeReplace();

  useEffect(() => {
    const token = getToken();
    safeReplace(token ? "/dashboard" : "/login");
  }, [safeReplace]);

  return null;
}
