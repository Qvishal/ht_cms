"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "ht_cms_theme";

type ThemeState = {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function applyResolvedTheme(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = readStoredMode();
    setModeState(stored);
    const nextResolved = stored === "system" ? getSystemTheme() : stored;
    setResolved(nextResolved);
    applyResolvedTheme(nextResolved);
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const mm = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mm) return;
    const handler = () => {
      const nextResolved = getSystemTheme();
      setResolved(nextResolved);
      applyResolvedTheme(nextResolved);
    };
    mm.addEventListener?.("change", handler);
    return () => mm.removeEventListener?.("change", handler);
  }, [mode]);

  function setMode(next: ThemeMode) {
    setModeState(next);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, next);
    const nextResolved = next === "system" ? getSystemTheme() : next;
    setResolved(nextResolved);
    applyResolvedTheme(nextResolved);
  }

  function toggle() {
    const nextResolved = resolved === "dark" ? "light" : "dark";
    setMode(nextResolved);
  }

  const value = useMemo<ThemeState>(() => ({ mode, resolved, setMode, toggle }), [mode, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

