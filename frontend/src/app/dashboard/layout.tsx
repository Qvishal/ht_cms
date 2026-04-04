"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { apiGet, apiPost } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tables, setTables] = useState<string[] | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    loadTables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

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

  return (
    <div className="min-h-screen grid md:grid-cols-[260px_1fr]">
      <aside className="border-r p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">HT CMS</div>
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

        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">TABLES</div>
            <AddTableDialog onCreated={loadTables} />
          </div>
          {tables === null ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : tables.length === 0 ? (
            <div className="text-sm text-muted-foreground">No tables yet. Go to Setup.</div>
          ) : (
            <nav className="space-y-1">
              {tables.map((t) => {
                const active = pathname?.includes(`/dashboard/${t}`);
                return (
                  <Link
                    key={t}
                    href={`/dashboard/${t}`}
                    className={`block rounded-md px-3 py-2 text-sm hover:bg-muted ${
                      active ? "bg-muted" : ""
                    }`}
                  >
                    {t}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </aside>

      <main className="p-6">{children}</main>
    </div>
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
