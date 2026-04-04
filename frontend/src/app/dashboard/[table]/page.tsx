"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ColumnType = "string" | "number" | "boolean" | "date" | "json";
type SchemaColumn = { name: string; type: ColumnType; required?: boolean };
type Row = Record<string, unknown> & { id: string };

export default function TablePage() {
  const params = useParams<{ table: string }>();
  const tableName = params.table;

  const [columns, setColumns] = useState<SchemaColumn[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([apiGet(`/tables/${tableName}/columns`), apiGet(`/data/${tableName}`)]);
      setColumns(c.columns ?? []);
      setRows(r.rows ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  const tableColumns = useMemo<ColumnDef<Row>[]>(() => {
    const base: ColumnDef<Row>[] = [
      { header: "id", accessorKey: "id" },
      ...(columns ?? []).map((c) => ({ header: c.name, accessorKey: c.name })),
      { header: "created_at", accessorKey: "created_at" }
    ];
    return base;
  }, [columns]);

  const rt = useReactTable({
    data: rows ?? [],
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tableName}</h1>
          <p className="text-sm text-muted-foreground">Manage rows and schema.</p>
        </div>
        <div className="flex gap-2">
          <AddColumnDialog tableName={tableName} onDone={refresh} />
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
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rows</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : rows && rows.length === 0 ? (
            <div className="rounded-md border p-6 text-sm text-muted-foreground">No rows yet.</div>
          ) : (
            <div className="w-full overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  {rt.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => (
                        <th key={h.id} className="px-3 py-2 text-left font-medium">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left font-medium">Actions</th>
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rt.getRowModel().rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      {r.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                          {String(cell.getValue() ?? "")}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
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
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!confirm("Delete this row?")) return;
                              await apiDelete(`/data/${tableName}/${r.original.id}`);
                              toast.success("Deleted");
                              await refresh();
                            }}
                          >
                            Delete
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
    </div>
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
        <Input
          value={value ? JSON.stringify(value) : ""}
          placeholder='{"key":"value"}'
          onChange={(e) => {
            const v = e.target.value;
            try {
              onChange(v ? (JSON.parse(v) as unknown) : undefined);
            } catch {
              onChange(v);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">Paste JSON (object/array) or leave empty.</p>
      </div>
    );
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
                <SelectItem value="number">number</SelectItem>
                <SelectItem value="boolean">boolean</SelectItem>
                <SelectItem value="date">date</SelectItem>
                <SelectItem value="json">json</SelectItem>
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
