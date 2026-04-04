"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useFieldArray,
  useForm,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { apiGet, apiPost } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Ident = z.string().regex(/^[a-z][a-z0-9_]*$/, "Use lowercase snake_case (e.g. blog_posts)");

const ColumnSchema = z.object({
  name: Ident,
  type: z.enum(["string", "number", "boolean", "date", "json"]),
  required: z.boolean().default(false)
});

const TableSchema = z.object({
  name: Ident,
  columns: z.array(ColumnSchema).default([])
});

const SchemaPayload = z.object({
  tables: z.array(TableSchema).min(1, "Add at least one table")
});

type SchemaValues = z.infer<typeof SchemaPayload>;

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);

  const form = useForm<SchemaValues>({
    resolver: zodResolver(SchemaPayload),
    defaultValues: { tables: [{ name: "posts", columns: [{ name: "title", type: "string", required: true }] }] }
  });

  const tables = useFieldArray({ control: form.control, name: "tables" });

  const idx = useMemo(() => {
    const i = typeof selectedTableIndex === "number" ? selectedTableIndex : 0;
    return Math.min(Math.max(i, 0), Math.max(tables.fields.length - 1, 0));
  }, [selectedTableIndex, tables.fields.length]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiGet("/setup/status")
      .then((s) => {
        if (s.schemaInitialized) router.replace("/dashboard");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  async function apply(values: SchemaValues) {
    setSubmitting(true);
    try {
      await apiPost("/schema/apply", { tables: values.tables });
      toast.success("Schema applied");
      router.replace("/dashboard");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">First-time Setup</h1>
          <p className="text-sm text-muted-foreground">
            Define your content schema. This will create Postgres tables and persist to <code>schema/schema.json</code>.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tables</CardTitle>
              <CardDescription>Create one or more tables.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tables.fields.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${
                    i === idx ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelectedTableIndex(i)}
                >
                  {form.getValues(`tables.${i}.name`) || `table_${i + 1}`}
                </button>
              ))}

              <div className="pt-2 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    tables.append({ name: `table_${tables.fields.length + 1}`, columns: [] });
                    setSelectedTableIndex(tables.fields.length);
                  }}
                >
                  Add table
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={tables.fields.length <= 1}
                  onClick={() => {
                    tables.remove(idx);
                    setSelectedTableIndex(0);
                  }}
                >
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Table definition</CardTitle>
              <CardDescription>Columns are added as typed fields (id/created_at/updated_at are automatic).</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={form.handleSubmit(apply)}>
                <div className="space-y-2">
                  <Label>Table name</Label>
                  <Input {...form.register(`tables.${idx}.name`)} />
                  {form.formState.errors.tables?.[idx]?.name ? (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.tables[idx]?.name?.message as string}
                    </p>
                  ) : null}
                </div>

                <ColumnsEditor
                  control={form.control}
                  register={form.register}
                  watch={form.watch}
                  setValue={form.setValue}
                  tableIndex={idx}
                />

                <div className="flex justify-end">
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Applying…" : "Apply schema"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ColumnsEditor({
  control,
  register,
  watch,
  setValue,
  tableIndex
}: {
  control: Control<SchemaValues>;
  register: UseFormRegister<SchemaValues>;
  watch: UseFormWatch<SchemaValues>;
  setValue: UseFormSetValue<SchemaValues>;
  tableIndex: number;
}) {
  const columns = useFieldArray({ control, name: `tables.${tableIndex}.columns` as const });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Columns</div>
          <div className="text-xs text-muted-foreground">Use snake_case column names.</div>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => columns.append({ name: `field_${columns.fields.length + 1}`, type: "string", required: false })}
        >
          Add column
        </Button>
      </div>

      {columns.fields.length === 0 ? (
        <div className="rounded-md border p-4 text-sm text-muted-foreground">No columns yet.</div>
      ) : (
        <div className="space-y-3">
          {columns.fields.map((c, i) => (
            <div key={c.id} className="grid gap-3 md:grid-cols-[1fr_180px_140px_auto] items-end">
              <div className="space-y-2">
                <Label>Column name</Label>
                <Input {...register(`tables.${tableIndex}.columns.${i}.name`)} />
              </div>

              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={watch(`tables.${tableIndex}.columns.${i}.type`)}
                  onValueChange={(v) =>
                    setValue(`tables.${tableIndex}.columns.${i}.type`, v as SchemaValues["tables"][number]["columns"][number]["type"], {
                      shouldValidate: true
                    })
                  }
                >
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

              <div className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!watch(`tables.${tableIndex}.columns.${i}.required`)}
                  onChange={(e) =>
                    setValue(`tables.${tableIndex}.columns.${i}.required`, e.target.checked, {
                      shouldValidate: true
                    })
                  }
                />
                <Label>Required</Label>
              </div>

              <Button type="button" variant="destructive" onClick={() => columns.remove(i)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
