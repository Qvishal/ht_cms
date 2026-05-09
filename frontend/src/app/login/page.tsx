"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { apiPost, apiPublicGet } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useSafeReplace } from "@/lib/safe-router";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

type LoginValues = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const safeReplace = useSafeReplace();
  const [status, setStatus] = useState<{ hasAdmin: boolean; schemaInitialized: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const mode = useMemo(() => {
    if (!status) return "loading";
    return status.hasAdmin ? "login" : "bootstrap";
  }, [status]);

  const form = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" }
  });

  useEffect(() => {
    apiPublicGet("/setup/status")
      .then((res) => setStatus({ hasAdmin: res.hasAdmin, schemaInitialized: res.schemaInitialized }))
      .catch(() => setStatus({ hasAdmin: false, schemaInitialized: false }));
  }, []);

  async function onSubmit(values: LoginValues) {
    setLoading(true);
    try {
      const endpoint = mode === "bootstrap" ? "/auth/bootstrap" : "/auth/login";
      const res = await apiPost(endpoint, values);
      if (!res?.token) throw new Error(res?.error ?? "Authentication failed");
      setToken(res.token);
      toast.success(mode === "bootstrap" ? "Admin created" : "Welcome back");
      // schemaInitialized is not returned by auth endpoints; check status after login
      const s = await apiPublicGet("/setup/status");
      safeReplace(s.schemaInitialized ? "/dashboard" : "/setup");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>HT CMS Admin</CardTitle>
          <CardDescription>
            {mode === "bootstrap" ? "Create the first admin user" : "Sign in to continue"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "loading" ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" placeholder="admin@company.com" {...form.register("email")} />
                {form.formState.errors.email ? (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...form.register("password")} />
                {form.formState.errors.password ? (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
                )}
              </div>

              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "Please wait…" : mode === "bootstrap" ? "Create admin" : "Sign in"}
              </Button>

              {mode === "login" ? (
                <p className="text-center text-sm text-muted-foreground">
                  Need an account?{" "}
                  <Link className="text-foreground underline underline-offset-4" href="/register">
                    Register
                  </Link>
                </p>
              ) : null}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
