"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const Icon = resolved === "dark" ? Sun : Moon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggle}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

