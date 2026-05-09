import caching from "./src/services/caching";

async function run() {
  const userId = "c5f9ad44-876d-48c4-90fd-8706898ce459";
  const tableName = "posts";
  const limit = 26;
  const offset = 0;
  
  const filters = [{ field: "includeDeleted", operator: "eq", value: true }];
  const cachedRows = await caching.getCachedUserQueryResult(tableName, userId, filters, limit, offset);
  console.log("cached with includeDeleted=true:", cachedRows);
}
run().catch(console.error).finally(() => process.exit(0));
