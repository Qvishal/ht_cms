import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning" | "error" | "outline";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variant === "default" && "bg-muted text-foreground border-border",
        variant === "outline" && "bg-transparent text-foreground border-border",
        variant === "success" && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
        variant === "warning" && "bg-amber-500/10 text-amber-600 border-amber-500/20",
        variant === "error" && "bg-rose-500/10 text-rose-600 border-rose-500/20",
        className
      )}
      {...props}
    />
  );
}

