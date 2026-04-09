"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";

import { apiDelete, apiGet, apiPost, apiPostFile, apiPut } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { isAdmin, useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";

type ColumnType = "string" | "text" | "number" | "boolean" | "date" | "json" | "image";
type SchemaColumn = { name: string; type: ColumnType; required?: boolean };
type Row = Record<string, unknown> & { id: string };
type TableAccess = {
  accessType: "read" | "write" | null;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canAlter: boolean;
  visibilityMode?: "GLOBAL_ACCESS" | "USER_SCOPED";
};

export default function TablePage() {
  const params = useParams<{ table: string }>();
  const tableName = params.table;
  const me = useMe();

  const [columns, setColumns] = useState<SchemaColumn[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [access, setAccess] = useState<TableAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowQuery, setRowQuery] = useState("");
  const [page, setPage] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const pageSize = 25;
  const [hasMore, setHasMore] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const includeDeletedQuery = isAdmin(me) && includeDeleted ? "&includeDeleted=1" : "";
      const [c, r, a] = await Promise.all([
        apiGet(`/tables/${tableName}/columns`),
        apiGet(`/data/${tableName}?limit=${pageSize + 1}&offset=${page * pageSize}${includeDeletedQuery}`),
        apiGet(`/tables/${tableName}/access`)
      ]);
      setColumns(c.columns ?? []);
      const all = (r.rows ?? []) as Row[];
      setHasMore(all.length > pageSize);
      setRows(all.slice(0, pageSize));
      setAccess(a ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(0);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, includeDeleted]);

  const filteredRows = useMemo(() => {
    const q = rowQuery.trim().toLowerCase();
    if (!q) return rows ?? [];
    const cols = columns ?? [];
    return (rows ?? []).filter((r) => {
      const hay = [
        r.id,
        ...cols.map((c) => (r[c.name] === null || r[c.name] === undefined ? "" : String(r[c.name]))),
        r.created_at ? String(r.created_at) : ""
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rowQuery, rows, columns]);

  const tableColumns = useMemo<ColumnDef<Row>[]>(() => {
    const base: ColumnDef<Row>[] = [
      { header: "id", accessorKey: "id" },
      ...(isAdmin(me) && includeDeleted
        ? [
            {
              header: "status",
              accessorKey: "is_deleted",
              cell: ({ row }) =>
                row.original.is_deleted ? (
                  <Badge variant="warning">deleted</Badge>
                ) : (
                  <Badge variant="success">active</Badge>
                )
            } as ColumnDef<Row>
          ]
        : []),
      ...(columns ?? []).map((c) => ({ header: c.name, accessorKey: c.name })),
      { header: "created_at", accessorKey: "created_at" }
    ];
    return base;
  }, [columns, includeDeleted, me]);

  const rt = useReactTable({
    data: filteredRows,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{tableName}</h1>
            {access?.accessType ? (
              <Badge variant={access.accessType === "write" ? "success" : "outline"}>
                {access.accessType}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {isAdmin(me) ? "Manage rows and schema." : "Manage rows for assigned tables."}
          </p>
          {access?.accessType === "read" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only access: you can view rows but cannot create, edit, or delete.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {isAdmin(me) ? (
            <div className="flex items-center gap-2 rounded-md border bg-background/40 px-3 h-10">
              <span className="text-xs text-muted-foreground">Visibility</span>
              <Select
                value={(access?.visibilityMode ?? "GLOBAL_ACCESS") as string}
                onValueChange={async (v) => {
                  setUpdatingVisibility(true);
                  try {
                    await apiPut(`/tables/${tableName}/visibility`, { visibilityMode: v });
                    toast.success("Visibility updated");
                    setAccess((prev) => (prev ? { ...prev, visibilityMode: v as "GLOBAL_ACCESS" | "USER_SCOPED" } : prev));
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setUpdatingVisibility(false);
                  }
                }}
                disabled={updatingVisibility}
              >
                <SelectTrigger className="h-8 w-[180px]">
                  <SelectValue placeholder="Visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL_ACCESS">GLOBAL_ACCESS</SelectItem>
                  <SelectItem value="USER_SCOPED">USER_SCOPED</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {isAdmin(me) ? (
            <label className="flex items-center gap-2 rounded-md border bg-background/40 px-3 h-10 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">Show deleted</span>
            </label>
          ) : null}
          {(access?.canAlter ?? isAdmin(me)) ? <AddColumnDialog tableName={tableName} onDone={refresh} /> : null}
          {(access?.canAlter ?? isAdmin(me)) ? (
            <ManageColumnsDialog tableName={tableName} onDone={refresh} />
          ) : null}
          {access?.canInsert ? (
            <RecordDialog
              title="Create"
              mode="create"
              trigger={<Button>Create</Button>}
              columns={columns ?? []}
              onSubmit={async (payload: Record<string, unknown>) => {
                await apiPost(`/data/${tableName}`, payload);
                toast.success("Created");
                await refresh();
              }}
            />
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base">Rows</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 rounded-md border bg-background/40 px-3 h-10">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  className="w-[220px] max-w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                  placeholder="Search rows…"
                  value={rowQuery}
                  onChange={(e) => setRowQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-xs text-muted-foreground">Page {page + 1}</div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore || loading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
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
          ) : rows && rows.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">No rows yet.</div>
          ) : (
            <div className="w-full overflow-auto rounded-md border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  {rt.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => (
                        <th key={h.id} className="px-3 py-2 text-left font-medium">
                          {h.isPlaceholder ? null : (
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 ${
                                h.column.getCanSort() ? "hover:opacity-80" : ""
                              }`}
                              onClick={h.column.getToggleSortingHandler()}
                              disabled={!h.column.getCanSort()}
                            >
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {h.column.getCanSort() ? <ArrowUpDown className="h-3.5 w-3.5" /> : null}
                            </button>
                          )}
                        </th>
                      ))}
                      {access?.canUpdate || access?.canDelete ? (
                        <th className="px-3 py-2 text-left font-medium">Actions</th>
                      ) : null}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rt.getRowModel().rows.map((r) => (
                    <tr key={r.id} className="border-t odd:bg-muted/20">
                      {r.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2 align-top">
                          {String(cell.getValue() ?? "")}
                        </td>
                      ))}
                      {access?.canUpdate || access?.canDelete ? (
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            {access?.canUpdate ? (
                              <RecordDialog
                                title="Edit"
                                mode="edit"
                                trigger={
                                  <Button size="sm" variant="secondary">
                                    Edit
                                  </Button>
                                }
                                columns={columns ?? []}
                                initial={r.original as Row}
                                onSubmit={async (payload: Record<string, unknown>) => {
                                  await apiPut(`/data/${tableName}/${r.original.id}`, payload);
                                  toast.success("Updated");
                                  await refresh();
                                }}
                              />
                            ) : null}
                            {access?.canDelete ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={async () => {
                                  if (r.original.is_deleted && isAdmin(me)) {
                                    if (!confirm("Restore this row?")) return;
                                    await apiPost(`/data/${tableName}/${r.original.id}/restore`, {});
                                    toast.success("Restored");
                                    await refresh();
                                    return;
                                  }
                                  if (!confirm("Delete this row? (soft delete)")) return;
                                  await apiDelete(`/data/${tableName}/${r.original.id}`);
                                  toast.success("Deleted");
                                  await refresh();
                                }}
                              >
                                {r.original.is_deleted && isAdmin(me) ? "Restore" : "Delete"}
                              </Button>
                            ) : null}
                            {isAdmin(me) ? (
                              <VersionsDialog tableName={tableName} rowId={String(r.original.id)} columns={columns ?? []} onRestored={refresh} />
                            ) : null}
                          </div>
                        </td>
                      ) : null}
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

function VersionsDialog({
  tableName,
  rowId,
  columns,
  onRestored
}: {
  tableName: string;
  rowId: string;
  columns: SchemaColumn[];
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<
    Array<{
      id: string;
      versionNumber: number;
      createdAt: string;
      updatedByEmail: string | null;
      updatedByName: string | null;
      data: Record<string, unknown>;
    }>
  >([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet(`/admin/tables/${tableName}/rows/${rowId}/versions`);
      setVersions(res.versions ?? []);
    } catch (e) {
      toast.error((e as Error).message);
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }

  async function restore(versionId: string) {
    if (!confirm("Restore this version? This will overwrite current values.")) return;
    setRestoring(versionId);
    try {
      await apiPost(`/admin/tables/${tableName}/rows/${rowId}/restore-version`, { versionId });
      toast.success("Version restored");
      setOpen(false);
      onRestored();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  function describe(v: Record<string, unknown>) {
    const parts: string[] = [];
    for (const c of columns.slice(0, 3)) {
      const raw = v[c.name];
      if (raw === null || raw === undefined || raw === "") continue;
      parts.push(`${c.name}: ${String(raw).slice(0, 40)}`);
    }
    return parts.join(" · ") || "—";
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) load();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Versions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <p className="text-sm text-muted-foreground">Row: {rowId}</p>
        </DialogHeader>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : versions.length === 0 ? (
          <div className="text-sm text-muted-foreground">No versions yet (versions are created on update).</div>
        ) : (
          <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
            {versions.map((v) => (
              <div key={v.id} className="rounded-md border p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">v{v.versionNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()} ·{" "}
                    {v.updatedByName ?? v.updatedByEmail ?? "unknown"}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground truncate">{describe(v.data)}</div>
                </div>
                <Button size="sm" onClick={() => restore(v.id)} disabled={restoring === v.id}>
                  {restoring === v.id ? "Restoring…" : "Restore"}
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordDialog({
  title,
  mode,
  trigger,
  columns,
  initial,
  onSubmit
}: {
  title: string;
  mode: "create" | "edit";
  trigger: React.ReactNode;
  columns: SchemaColumn[];
  initial?: Record<string, unknown>;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (open) setValues(initial ?? {});
  }, [open, initial]);

  async function save() {
    if (mode === "create") {
      for (const c of columns) {
        if (c.required && (values[c.name] === undefined || values[c.name] === null || values[c.name] === "")) {
          toast.error(`Missing required field "${c.name}"`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const c of columns) {
        if (values[c.name] !== undefined) payload[c.name] = values[c.name];
      }
      await onSubmit(payload);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {columns.length === 0 ? (
            <div className="text-sm text-muted-foreground">No custom columns. Insert defaults only.</div>
          ) : (
            columns.map((c) => (
              <FieldEditor
                key={c.name}
                col={c}
                value={values[c.name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [c.name]: v }))}
              />
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldEditor({
  col,
  value,
  onChange
}: {
  col: SchemaColumn;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (col.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Label>{col.name}</Label>
      </div>
    );
  }

  if (col.type === "json") {
    return (
      <div className="space-y-2">
        <Label>{col.name}</Label>
        <RichTextEditor value={String(value ?? "")} onChange={(html) => onChange(html || undefined)} />
        <p className="text-xs text-muted-foreground">Legacy type: stored as rich text.</p>
      </div>
    );
  }

  if (col.type === "text") {
    return (
      <div className="space-y-2">
        <Label>{col.name}</Label>
        <RichTextEditor value={String(value ?? "")} onChange={(html) => onChange(html || undefined)} />
      </div>
    );
  }

  if (col.type === "image") {
    return <ImageFieldEditor col={col} value={value} onChange={onChange} />;
  }

  const inputType = col.type === "number" ? "number" : col.type === "date" ? "datetime-local" : "text";

  return (
    <div className="space-y-2">
      <Label>{col.name}</Label>
      <Input
        type={inputType}
        value={(value as string | number | null | undefined) ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (col.type === "number") onChange(raw === "" ? undefined : Number(raw));
          else onChange(raw === "" ? undefined : raw);
        }}
      />
    </div>
  );
}

function ImageFieldEditor({
  col,
  value,
  onChange
}: {
  col: SchemaColumn;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [uploading, setUploading] = useState(false);

  // Build an authenticated preview URL for /uploads paths
  function previewSrc(url: string): string {
    if (!url) return url;
    // Only append token for our own backend upload paths
    if (url.includes("/uploads/")) {
      const token = getToken();
      if (token) {
        const sep = url.includes("?") ? "&" : "?";
        return `${url}${sep}token=${encodeURIComponent(token)}`;
      }
    }
    return url;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiPostFile("/upload", fd);
      onChange(res.url);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const src = value ? previewSrc(value as string) : null;

  return (
    <div className="space-y-3 p-3 rounded-md border bg-muted/10">
      <Label className="text-sm font-semibold">{col.name} (Image)</Label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label className="text-xs text-muted-foreground">URL Link</Label>
          <Input
            type="url"
            value={(value as string) ?? ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? undefined : e.target.value)
            }
            placeholder="https://example.com/image.png"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold text-muted-foreground">OR</div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Upload natively</Label>
            <Input
              type="file"
              accept="image/*"
              className="w-[200px]"
              disabled={uploading}
              onChange={handleFile}
            />
          </div>
        </div>
      </div>
      {uploading ? (
        <div className="text-xs text-muted-foreground animate-pulse">Uploading file...</div>
      ) : src ? (
        <div className="mt-2 space-y-1">
          <div className="rounded-md border p-1 w-fit bg-muted/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Preview"
              className="h-32 w-auto object-contain rounded-sm"
              onError={(e) => (e.currentTarget.style.display = 'none')}
              onLoad={(e) => (e.currentTarget.style.display = 'block')}
            />
          </div>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline hover:opacity-80"
          >
            Open in new tab ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}

function AddColumnDialog({ tableName, onDone }: { tableName: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("string");
  const [required, setRequired] = useState(false);

  async function submit() {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      toast.error("Invalid column name (use snake_case)");
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/tables/${tableName}/columns`, { name, type, required });
      toast.success("Column added");
      setOpen(false);
      setName("");
      setType("string");
      setRequired(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Add column</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add column</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Column name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="author_name" />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ColumnType)}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">string</SelectItem>
              <SelectItem value="text">text</SelectItem>
              <SelectItem value="number">number</SelectItem>
              <SelectItem value="boolean">boolean</SelectItem>
              <SelectItem value="date">date</SelectItem>
              <SelectItem value="image">image</SelectItem>
            </SelectContent>
          </Select>
        </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            <Label>Required</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageColumnsDialog({ tableName, onDone }: { tableName: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [cols, setCols] = useState<Array<SchemaColumn & { active?: boolean }>>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet(`/tables/${tableName}/columns/all`);
      setCols(res.columns ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveColumn(name: string) {
    const col = cols.find((c) => c.name === name);
    if (!col) return;
    setSaving(name);
    try {
      await apiPut(`/tables/${tableName}/columns/${name}`, {
        type: col.type,
        required: !!col.required,
        active: col.active !== false
      });
      toast.success("Column updated");
      await load();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function hideColumn(name: string) {
    if (!confirm(`Hide column "${name}"? Data will be kept, but the column will disappear from forms.`)) return;
    setSaving(name);
    try {
      await apiDelete(`/tables/${tableName}/columns/${name}`);
      toast.success("Column hidden");
      await load();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function restoreColumn(name: string) {
    setSaving(name);
    try {
      await apiPut(`/tables/${tableName}/columns/${name}`, { active: true });
      toast.success("Column restored");
      await load();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Manage columns</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Columns — {tableName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : cols.length === 0 ? (
          <div className="text-sm text-muted-foreground">No custom columns yet.</div>
        ) : (
          <div className="max-h-[460px] overflow-auto space-y-3 pr-1">
            {cols.map((c) => {
              const active = c.active !== false;
              return (
                <div key={c.name} className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="flex gap-2">
                      {active ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => hideColumn(c.name)}
                          disabled={saving === c.name}
                        >
                          {saving === c.name ? "Working…" : "Hide"}
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => restoreColumn(c.name)} disabled={saving === c.name}>
                          {saving === c.name ? "Working…" : "Restore"}
                        </Button>
                      )}
                      <Button size="sm" onClick={() => saveColumn(c.name)} disabled={saving === c.name || !active}>
                        {saving === c.name ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[180px_1fr] items-center">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Type</div>
                      <Select
                        value={c.type}
                        onValueChange={(v) =>
                          setCols((prev) => prev.map((x) => (x.name === c.name ? { ...x, type: v as ColumnType } : x)))
                        }
                        disabled={!active}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">string</SelectItem>
                          <SelectItem value="text">text</SelectItem>
                          <SelectItem value="number">number</SelectItem>
                          <SelectItem value="boolean">boolean</SelectItem>
                          <SelectItem value="date">date</SelectItem>
                          <SelectItem value="image">image</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2 pt-5">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={!!c.required}
                        onChange={(e) =>
                          setCols((prev) => prev.map((x) => (x.name === c.name ? { ...x, required: e.target.checked } : x)))
                        }
                        disabled={!active}
                      />
                      <Label>Required</Label>
                    </div>
                  </div>

                  {!active ? (
                    <p className="text-xs text-muted-foreground">Hidden columns are not shown in create/edit forms.</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
