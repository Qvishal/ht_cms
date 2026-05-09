const IDENT_RE = /^[a-z][a-z0-9_]*$/;

export function assertIdent(
  name: string,
  kind: "table" | "column" | "field",
): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(
      `Invalid ${kind} name "${name}". Use lowercase snake_case.`,
    );
  }
}

export function quoteIdent(name: string): string {
  // Defensive quoting; names are already validated by assertIdent.
  const dialect = process.env.DB_DIALECT === "mysql" ? "mysql" : "postgres";
  if (dialect === "mysql") {
    return `\`${name.replaceAll("`", "``")}\``;
  }
  return `"${name.replaceAll('"', '""')}"`;
}
