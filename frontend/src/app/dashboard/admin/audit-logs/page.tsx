"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api";
import { useMe } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type User = { id: string; email: string; name: string | null; role: "admin" | "user" };
type TableInfo = { id: string; name: string };
type AuditActionType = "CREATE" | "UPDATE" | "DELETE" | "STRUCTURE_CHANGE" | "PERMISSION_CHANGE";

type LogRow = {
  id: string;
  actionType: AuditActionType;
  createdAt: string;
  rowId: string | null;
  tableId: string | null;
  tableName: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  oldValue: unknown | null;
  newValue: unknown | null;
};

export default function AuditLogsPage() {
  const me = useMe();
  const [users, setUsers] = useState<User[] | null>(null);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [query, setQuery] = useState("");

  const [userId, setUserId] = useState<string>("all");
  const [tableId, setTableId] = useState<string>("all");
  const [actionType, setActionType] = useState<string>("all");

  const [offset, setOffset] = useState(0);
  const limit = 50;

  const loading = users === null || tables === null || logs === null;

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs ?? [];
    return (logs ?? []).filter((l) => {
      const hay = [
        l.actionType,
        l.tableName ?? "",
        l.userEmail ?? "",
        l.userName ?? "",
        l.rowId ?? "",
        l.id
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [logs, query]);

  async function loadMeta() {
    const [u, t] = await Promise.all([apiGet("/admin/users"), apiGet("/admin/tables")]);
    setUsers(u.users ?? []);
    setTables(t.tables ?? []);
  }

  async function loadLogs(nextOffset = offset) {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    qs.set("offset", String(nextOffset));
    if (userId !== "all") qs.set("userId", userId);
    if (tableId !== "all") qs.set("tableId", tableId);
    if (actionType !== "all") qs.set("actionType", actionType);
    const res = await apiGet(`/admin/audit-logs?${qs.toString()}`);
    setLogs(res.logs ?? []);
  }

  useEffect(() => {
    if (!me) return;
    if (me.role !== "admin") return;
    Promise.all([loadMeta(), loadLogs(0)])
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setOffset(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  useEffect(() => {
    if (!me || me.role !== "admin") return;
    setLogs(null);
    loadLogs(0)
      .then(() => setOffset(0))
      .catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tableId, actionType]);

  if (!me) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (me.role !== "admin") return <div className="text-sm text-muted-foreground">Forbidden.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">Track row changes, schema changes, and permission updates.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Events</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 rounded-md border bg-background/40 px-3 h-10">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  className="w-[220px] max-w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                  placeholder="Search logs…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="CREATE">CREATE</SelectItem>
                  <SelectItem value="UPDATE">UPDATE</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="STRUCTURE_CHANGE">STRUCTURE_CHANGE</SelectItem>
                  <SelectItem value="PERMISSION_CHANGE">PERMISSION_CHANGE</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tableId} onValueChange={setTableId}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Table" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tables</SelectItem>
                  {(tables ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="User" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">No events found.</div>
          ) : (
            <div className="w-full overflow-auto rounded-md border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">When</th>
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                    <th className="px-3 py-2 text-left font-medium">Table</th>
                    <th className="px-3 py-2 text-left font-medium">User</th>
                    <th className="px-3 py-2 text-left font-medium">Row</th>
                    <th className="px-3 py-2 text-left font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((l) => (
                    <tr key={l.id} className="border-t odd:bg-muted/20">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <ActionBadge action={l.actionType} />
                      </td>
                      <td className="px-3 py-2">{l.tableName ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="text-sm">{l.userName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{l.userEmail ?? "system"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{l.rowId ? shortId(l.rowId) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[520px]">
                        {summarize(l.newValue ?? l.oldValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const next = Math.max(0, offset - limit);
                setLogs(null);
                setOffset(next);
                await loadLogs(next);
              }}
              disabled={offset === 0 || logs === null}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const next = offset + limit;
                setLogs(null);
                setOffset(next);
                await loadLogs(next);
              }}
              disabled={logs === null || (logs?.length ?? 0) < limit}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function shortId(id: string) {
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function summarize(v: unknown) {
  if (!v) return "—";
  if (typeof v === "string") return v.slice(0, 160);
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return String(v).slice(0, 160);
  }
}

function ActionBadge({ action }: { action: AuditActionType }) {
  const variant =
    action === "CREATE"
      ? "success"
      : action === "DELETE"
        ? "error"
        : action === "STRUCTURE_CHANGE"
          ? "warning"
          : action === "PERMISSION_CHANGE"
            ? "warning"
            : "outline";
  return <Badge variant={variant}>{action}</Badge>;
}

