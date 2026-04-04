"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Menu, Search } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiPost } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { isAdmin, SessionProvider, type Me } from "@/lib/session";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tables, setTables] = useState<string[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [tableQuery, setTableQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    loadMeAndTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadMeAndTables() {
    try {
      const [m, t] = await Promise.all([apiGet("/me"), apiGet("/tables")]);
      setMe(m.user ?? null);
      setTables(t.tables ?? []);
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to load session");
      if ((e as Error).message?.toLowerCase().includes("unauthorized")) {
        clearToken();
        router.replace("/login");
      }
    }
  }

  async function loadTables() {
    try {
      const res = await apiGet("/tables");
      setTables(res.tables ?? []);
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to load tables");
      if ((e as Error).message?.toLowerCase().includes("unauthorized")) {
        clearToken();
        router.replace("/login");
      }
    }
  }

  const filteredTables = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    if (!q) return tables ?? [];
    return (tables ?? []).filter((t) => t.toLowerCase().includes(q));
  }, [tableQuery, tables]);

  return (
    <SessionProvider me={me}>
      <div className="min-h-screen flex">
        <aside className="hidden md:flex md:w-72 md:flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
          <SidebarContent
            me={me}
            pathname={pathname ?? ""}
            tables={filteredTables}
            tablesLoading={tables === null}
            tableQuery={tableQuery}
            onTableQueryChange={setTableQuery}
            onCreateTable={loadTables}
            onNavigate={() => {}}
          />
        </aside>

        <div className="flex-1 min-w-0">
          <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
            <div className="h-14 px-4 md:px-6 flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-2 min-w-0">
                <div className="text-sm font-semibold tracking-tight">HT CMS</div>
                <Badge variant={isAdmin(me) ? "success" : "outline"}>
                  {isAdmin(me) ? "admin" : "user"}
                </Badge>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* <div className="hidden lg:flex items-center gap-2 rounded-md border bg-background/40 px-3 h-10">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    className="w-56 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                    placeholder="Search tables…"
                    value={tableQuery}
                    onChange={(e) => setTableQuery(e.target.value)}
                  />
                </div> */}
                <ThemeToggle />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  onClick={() => {
                    clearToken();
                    router.replace("/login");
                  }}
                  aria-label="Logout"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
                <div className="hidden sm:flex items-center gap-2">
                  <div className="text-sm text-muted-foreground max-w-[220px] truncate">
                    {me?.name ?? "…"}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      clearToken();
                      router.replace("/login");
                    }}
                  >
                    Logout
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <main className="p-4 md:p-6">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="!left-0 !top-0 !translate-x-0 !translate-y-0 !rounded-none !w-[86vw] !max-w-[360px] !h-screen !p-0">
          <div className="h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
            <SidebarContent
              me={me}
              pathname={pathname ?? ""}
              tables={filteredTables}
              tablesLoading={tables === null}
              tableQuery={tableQuery}
              onTableQueryChange={setTableQuery}
              onCreateTable={loadTables}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </SessionProvider>
  );
}

function AddTableDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  async function create() {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      toast.error("Invalid table name (use snake_case)");
      return;
    }
    setSaving(true);
    try {
      await apiPost("/tables", { name, columns: [] });
      toast.success("Table created");
      setOpen(false);
      setName("");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          + New
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New table</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Table name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="comments" />
          <p className="text-xs text-muted-foreground">Use lowercase snake_case.</p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SidebarContent({
  me,
  pathname,
  tables,
  tablesLoading,
  tableQuery,
  onTableQueryChange,
  onCreateTable,
  onNavigate
}: {
  me: Me | null;
  pathname: string;
  tables: string[];
  tablesLoading: boolean;
  tableQuery: string;
  onTableQueryChange: (v: string) => void;
  onCreateTable: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="h-14 px-4 flex items-center justify-between border-b border-sidebar-border">
        <div className="text-sm font-semibold tracking-tight">Workspace</div>
        {isAdmin(me) ? <AddTableDialog onCreated={onCreateTable} /> : null}
      </div>

      <div className="p-4 space-y-3">
        <div className="space-y-2">
          <div className="text-xs font-medium text-sidebar-foreground/70">Tables</div>
          <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-muted px-3 h-10">
            <Search className="h-4 w-4 text-sidebar-foreground/70" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-sidebar-foreground/50"
              placeholder="Filter tables…"
              value={tableQuery}
              onChange={(e) => onTableQueryChange(e.target.value)}
            />
          </div>
        </div>

        {tablesLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full bg-sidebar-muted" />
            <Skeleton className="h-9 w-full bg-sidebar-muted" />
            <Skeleton className="h-9 w-full bg-sidebar-muted" />
          </div>
        ) : tables.length === 0 ? (
          <div className="text-sm text-sidebar-foreground/70">
            {isAdmin(me) ? "No tables yet. Create one to get started." : "No tables assigned yet."}
          </div>
        ) : (
          <nav className="space-y-1">
            {tables.map((t) => {
              const active = pathname.includes(`/dashboard/${t}`);
              return (
                <Link
                  key={t}
                  href={`/dashboard/${t}`}
                  onClick={onNavigate}
                  className={`block rounded-md px-3 py-2 text-sm hover:bg-sidebar-muted ${
                    active ? "bg-sidebar-muted" : ""
                  }`}
                >
                  {t}
                </Link>
              );
            })}
          </nav>
        )}

        {isAdmin(me) ? (
          <div className="pt-3 space-y-2">
            <div className="text-xs font-medium text-sidebar-foreground/70">Admin</div>
            <nav className="space-y-1">
              <Link
                href="/dashboard/admin/users"
                onClick={onNavigate}
                className={`block rounded-md px-3 py-2 text-sm hover:bg-sidebar-muted ${
                  pathname.startsWith("/dashboard/admin/users") ? "bg-sidebar-muted" : ""
                }`}
              >
                Users & Permissions
              </Link>
              <Link
                href="/dashboard/admin/audit-logs"
                onClick={onNavigate}
                className={`block rounded-md px-3 py-2 text-sm hover:bg-sidebar-muted ${
                  pathname === "/dashboard/admin/audit-logs" ? "bg-sidebar-muted" : ""
                }`}
              >
                Audit Logs
              </Link>
            </nav>
          </div>
        ) : null}
      </div>

      <div className="mt-auto p-4 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/70">Signed in</div>
        <div className="text-sm font-medium truncate">{me?.email ?? "…"}</div>
      </div>
    </div>
  );
}
