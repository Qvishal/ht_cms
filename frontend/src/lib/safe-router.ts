"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

// Prevents accidental redirect loops / excessive replaceState calls.
export function useSafeReplace() {
  const router = useRouter();
  const pathname = usePathname();
  const last = useRef<{ to: string | null; at: number }>({ to: null, at: 0 });

  return useCallback(
    (to: string) => {
      if (!to) return;
      if (pathname === to) return;

      const now = Date.now();
      if (last.current.to === to && now - last.current.at < 1000) return;

      last.current = { to, at: now };
      router.replace(to);
    },
    [router, pathname],
  );
}

