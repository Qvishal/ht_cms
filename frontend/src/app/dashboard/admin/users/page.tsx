"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type User = { id: string; email: string; name: string | null; role: "admin" | "user" };
type TableInfo = { id: string; name: string; visibilityMode?: "GLOBAL_ACCESS" | "USER_SCOPED" };
type Permission = { tableId: string; tableName: string; accessType: "read" | "write" };

export default function AdminUsersPage() {
  const me = useMe();
  const [users, setUsers] = useState<User[] | null>(null);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [query, setQuery] = useState("");

  const loading = users === null || tables === null;

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users ?? [];
    return (users ?? []).filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.role.includes(q) ||
        u.name?.toLowerCase().includes(q),
    );
  }, [query, users]);

  async function load() {
    try {
      const [u, t] = await Promise.all([apiGet("/admin/users"), apiGet("/admin/tables")]);
      setUsers(u.users ?? []);
      setTables(t.tables ?? []);
    } catch (e) {
      toast.error((e as Error).message);
      setUsers([]);
      setTables([]);
    }
  }

  useEffect(() => {
    if (!me) return;
    if (me.role !== "admin") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  if (!me) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (me.role !== "admin") {
    return <div className="text-sm text-muted-foreground">Forbidden.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users & Permissions</h1>
          <p className="text-sm text-muted-foreground">Create users, set roles, and assign table access.</p>
        </div>
        <CreateUserDialog onCreated={load} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Users</CardTitle>
            <div className="flex items-center gap-2 rounded-md border bg-background/40 px-3 h-10">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                className="w-[240px] max-w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                placeholder="Search users…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : users && users.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">No users yet.</div>
          ) : (
            <div className="w-full overflow-auto rounded-md border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">User</th>
                    <th className="px-3 py-2 text-left font-medium">Role</th>
                    <th className="px-3 py-2 text-left font-medium">Access</th>
                    <th className="px-3 py-2 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="border-t odd:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <RoleSelect
                            user={u}
                            onChanged={(next) =>
                              setUsers((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))
                            }
                          />
                          <Badge variant={u.role === "admin" ? "success" : "outline"}>{u.role}</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <PermissionsDialog user={u} tables={tables ?? []} onSaved={load} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <EditUserDialog user={u} isSelf={u.id === me.id} onSaved={load} />
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={u.id === me.id}
                            onClick={async () => {
                              if (!confirm(`Remove user "${u.email}"?`)) return;
                              try {
                                await apiDelete(`/admin/users/${u.id}`);
                                toast.success("User removed");
                                await load();
                              } catch (e) {
                                toast.error((e as Error).message);
                              }
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Tables & Visibility</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">Manage which tables are global vs. user-scoped.</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : tables && tables.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">No tables exist yet.</div>
          ) : (
            <div className="w-full overflow-auto rounded-md border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Table Name</th>
                    <th className="px-3 py-2 text-left font-medium">Visibility Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {(tables ?? []).map((t) => (
                    <tr key={t.id} className="border-t odd:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className="px-3 py-2">
                        <VisibilitySelect
                          table={t}
                          onChanged={(next) =>
                            setTables((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VisibilitySelect({ table, onChanged }: { table: TableInfo; onChanged: (t: TableInfo) => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <Select
      value={table.visibilityMode ?? "GLOBAL_ACCESS"}
      onValueChange={async (v) => {
        setSaving(true);
        try {
          await apiPut(`/tables/${table.name}/visibility`, { visibilityMode: v });
          onChanged({ ...table, visibilityMode: v as "GLOBAL_ACCESS" | "USER_SCOPED" });
          toast.success("Visibility updated");
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
      disabled={saving}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Visibility" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="GLOBAL_ACCESS">GLOBAL_ACCESS</SelectItem>
        <SelectItem value="USER_SCOPED">USER_SCOPED</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RoleSelect({ user, onChanged }: { user: User; onChanged: (u: User) => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <Select
      value={user.role}
      onValueChange={async (v) => {
        setSaving(true);
        try {
          const res = await apiPut(`/admin/users/${user.id}/role`, { role: v });
          onChanged(res.user as User);
          toast.success("Role updated");
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
      disabled={saving}
    >
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="Role" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">admin</SelectItem>
        <SelectItem value="user">user</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  async function submit() {
    setSaving(true);
    try {
      await apiPost("/admin/users", { name: name.trim() || undefined, email, password, role });
      toast.success("User created");
      setOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
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
        <Button>+ New user</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "user")}>
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="user">user</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !email || password.length < 8}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  isSelf,
  onSaved
}: {
  user: User;
  isSelf: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(user.name ?? "");
    setEmail(user.email);
    setPassword("");
  }, [open, user.email, user.name]);

  async function save() {
    setSaving(true);
    try {
      await apiPut(`/admin/users/${user.id}`, {
        name: name.trim() ? name.trim() : null,
        email,
        ...(password ? { password } : {}),
      });
      toast.success("User updated");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              disabled={isSelf}
            />
            {isSelf ? (
              <p className="text-xs text-muted-foreground">Cannot change your own email from this screen.</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Reset password</Label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Leave blank to keep"
            />
            <p className="text-xs text-muted-foreground">Set a new password (min 8 chars) or leave blank.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !email}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({ user, tables, onSaved }: { user: User; tables: TableInfo[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<Record<string, "none" | "read" | "write">>({});

  const tableList = useMemo(() => tables ?? [], [tables]);

  async function loadPermissions() {
    setLoading(true);
    try {
      const res = await apiGet(`/admin/users/${user.id}/permissions`);
      const perms: Permission[] = res.permissions ?? [];
      const next: Record<string, "none" | "read" | "write"> = {};
      for (const t of tableList) next[t.id] = "none";
      for (const p of perms) next[p.tableId] = p.accessType;
      setValues(next);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const permissions = Object.entries(values)
        .filter(([, v]) => v !== "none")
        .map(([tableId, accessType]) => ({ tableId, accessType }));
      await apiPut(`/admin/users/${user.id}/permissions`, { permissions });
      toast.success("Permissions saved");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) loadPermissions();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Table access — {user.email}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">read</span>: view only ·{" "}
            <span className="font-medium text-foreground">write</span>: create/edit/delete rows
          </p>
        </DialogHeader>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : tableList.length === 0 ? (
          <div className="text-sm text-muted-foreground">No tables exist yet.</div>
        ) : (
          <div className="max-h-[420px] overflow-auto space-y-3 pr-1">
            {tableList.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="text-sm font-medium">{t.name}</div>
                <Select
                  value={values[t.id] ?? "none"}
                  onValueChange={(v) => setValues((prev) => ({ ...prev, [t.id]: v as "none" | "read" | "write" }))}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Access" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none</SelectItem>
                    <SelectItem value="read">read</SelectItem>
                    <SelectItem value="write">write</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
