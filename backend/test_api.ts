import { listRows } from "./src/services/crud";

async function run() {
  const ctx = {
    userId: "c5f9ad44-876d-48c4-90fd-8706898ce459",
    isAdmin: true,
    visibilityMode: "GLOBAL_ACCESS" as const,
    includeDeleted: true
  };
  const rows = await listRows("posts", 26, 0, ctx);
  console.log("includeDeleted=true rows:", rows);

  ctx.includeDeleted = false;
  const rows2 = await listRows("posts", 26, 0, ctx);
  console.log("includeDeleted=false rows:", rows2);
}
run().catch(console.error).finally(() => process.exit(0));
