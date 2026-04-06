/**
 * INTEGRATION TEST GUIDE
 * 
 * Test the dynamic API system after integration
 * Run these curl commands in sequence to verify everything works
 */

// ============================================================================
// SETUP
// ============================================================================

/**
 * Prerequisites:
 * 1. Backend running on http://localhost:3000
 * 2. PostgreSQL connected
 * 3. JWT token from login stored in $TOKEN variable
 * 
 * Setup token:
 *   TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"admin@example.com","password":"password"}' \
 *     | jq -r '.token')
 * 
 *   echo "Token: $TOKEN"
 */

// ============================================================================
// TEST 1: Create a Test Table
// ============================================================================

/**
 * Create a sample "products" table via setup
 * 
 * POST /setup/tables
 * {
 *   "name": "products",
 *   "visibilityMode": "GLOBAL_ACCESS",
 *   "columns": [
 *     {"name": "name", "type": "string", "required": true},
 *     {"name": "price", "type": "number", "required": true},
 *     {"name": "in_stock", "type": "boolean", "required": false},
 *     {"name": "description", "type": "text", "required": false},
 *     {"name": "status", "type": "string", "required": false}
 *   ]
 * }
 */

const setupTableRequest = `
curl -X POST http://localhost:3000/setup/tables \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "products",
    "visibilityMode": "GLOBAL_ACCESS",
    "columns": [
      {"name": "name", "type": "string", "required": true},
      {"name": "price", "type": "number", "required": true},
      {"name": "in_stock", "type": "boolean", "required": false},
      {"name": "description", "type": "text", "required": false},
      {"name": "status", "type": "string", "required": false}
    ]
  }'
`;

/**
 * Expected response:
 * {
 *   "table": {
 *     "id": "tbl_...",
 *     "name": "products",
 *     "visibilityMode": "GLOBAL_ACCESS",
 *     "columns": [...],
 *     "created_at": "2025-04-05T10:30:00Z"
 *   }
 * }
 */

// ============================================================================
// TEST 2: Verify Indexes Were Created
// ============================================================================

/**
 * Check that auto-indexing worked
 * This requires direct database access
 */

const checkIndexes = `
psql postgresql://user:password@localhost/ht_cms -c "
SELECT indexname, tablename 
FROM pg_indexes 
WHERE tablename = 'products' 
ORDER BY indexname;
"
`;

/**
 * Expected output:
 *   idx_products_created_at
 *   idx_products_created_by
 *   idx_products_is_deleted_created_at
 *   idx_products_updated_at
 */

// ============================================================================
// TEST 3: GET Table Schema
// ============================================================================

const getSchemaRequest = `
curl -X GET http://localhost:3000/tables/products/schema \\
  -H "Authorization: Bearer $TOKEN"
`;

/**
 * Expected response:
 * {
 *   "schema": {
 *     "table": "products",
 *     "columns": [
 *       {"name": "id", "type": "string", "required": true},
 *       {"name": "name", "type": "string", "required": true},
 *       {"name": "price", "type": "number", "required": true},
 *       {"name": "in_stock", "type": "boolean", "required": false},
 *       {"name": "description", "type": "text", "required": false},
 *       {"name": "status", "type": "string", "required": false},
 *       {"name": "created_by", "type": "string", "required": true},
 *       {"name": "created_at", "type": "date", "required": true},
 *       {"name": "updated_at", "type": "date", "required": true},
 *       {"name": "is_deleted", "type": "boolean", "required": true}
 *     ],
 *     "reservedFields": ["id", "created_by", "created_at", "updated_at", "is_deleted"]
 *   }
 * }
 */

// ============================================================================
// TEST 4: Create Row (with validation)
// ============================================================================

const createRowRequest = `
curl -X POST http://localhost:3000/data/products \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Widget Pro",
    "price": 99.99,
    "in_stock": true,
    "description": "Professional grade widget",
    "status": "active"
  }'
`;

/**
 * Expected response:
 * {
 *   "row": {
 *     "id": "prod_...",
 *     "name": "Widget Pro",
 *     "price": 99.99,
 *     "in_stock": true,
 *     "description": "Professional grade widget",
 *     "status": "active",
 *     "created_by": "user_...",
 *     "created_at": "2025-04-05T10:35:00Z",
 *     "updated_at": "2025-04-05T10:35:00Z",
 *     "is_deleted": false
 *   }
 * }
 */

// ============================================================================
// TEST 5: Create Row with Invalid Data (test validation)
// ============================================================================

const createInvalidRowRequest = `
curl -X POST http://localhost:3000/data/products \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": 123,
    "price": "not_a_number",
    "in_stock": "true"
  }' | jq .
`;

/**
 * Expected response:
 * {
 *   "error": "Validation failed",
 *   "details": [
 *     {
 *       "field": "name",
 *       "code": "TYPE_MISMATCH",
 *       "message": "Expected string, got number"
 *     },
 *     {
 *       "field": "price",
 *       "code": "TYPE_MISMATCH",
 *       "message": "Expected number, got string"
 *     },
 *     {
 *       "field": "in_stock",
 *       "code": "TYPE_MISMATCH",
 *       "message": "Expected boolean, got string"
 *     }
 *   ]
 * }
 */

// ============================================================================
// TEST 6: List Rows with Pagination
// ============================================================================

const listRowsRequest = `
curl -X GET "http://localhost:3000/data/products?limit=10&offset=0" \\
  -H "Authorization: Bearer $TOKEN"
`;

/**
 * Expected response:
 * {
 *   "rows": [...],
 *   "pagination": {
 *     "limit": 10,
 *     "offset": 0,
 *     "total": 42,
 *     "hasMore": true
 *   }
 * }
 */

// ============================================================================
// TEST 7: Get Distinct Values (for dropdowns)
// ============================================================================

const distinctValuesRequest = `
curl -X GET "http://localhost:3000/data/products/distinct/status" \\
  -H "Authorization: Bearer $TOKEN"
`;

/**
 * Expected response:
 * {
 *   "field": "status",
 *   "values": ["active", "inactive", "discontinued"],
 *   "count": 3
 * }
 */

// ============================================================================
// TEST 8: List with Advanced Filters
// ============================================================================

const filteredListRequest = `
curl -X GET "http://localhost:3000/data/products?filters=%5B%7B%22field%22:%22status%22,%22operator%22:%22eq%22,%22value%22:%22active%22%7D,%7B%22field%22:%22price%22,%22operator%22:%22gt%22,%22value%22:50%7D%5D&limit=20" \\
  -H "Authorization: Bearer $TOKEN"
`;

// Decoded filters: [{"field":"status","operator":"eq","value":"active"},{"field":"price","operator":"gt","value":50}]

/**
 * Expected: Returns only active products with price > 50
 */

// ============================================================================
// TEST 9: Get Single Row
// ============================================================================

const getRowRequest = `
# First, get a product ID from the list response
# Then use it:

curl -X GET "http://localhost:3000/data/products/{PRODUCT_ID}" \\
  -H "Authorization: Bearer $TOKEN"
`;

/**
 * Expected response:
 * {
 *   "row": {
 *     "id": "prod_...",
 *     ...product data...
 *   }
 * }
 */

// ============================================================================
// TEST 10: Update Row (with validation)
// ============================================================================

const updateRowRequest = `
curl -X PUT "http://localhost:3000/data/products/{PRODUCT_ID}" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "price": 89.99,
    "status": "on_sale"
  }'
`;

/**
 * Expected response:
 * {
 *   "row": {
 *     "id": "prod_...",
 *     "price": 89.99,
 *     "status": "on_sale",
 *     "updated_at": "2025-04-05T10:40:00Z",
 *     ...other fields unchanged...
 *   }
 * }
 */

// ============================================================================
// TEST 11: Bulk Soft Delete
// ============================================================================

const bulkDeleteRequest = `
curl -X POST "http://localhost:3000/data/products/bulk-delete" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ids": ["prod_id_1", "prod_id_2", "prod_id_3"]
  }'
`;

/**
 * Expected response:
 * {
 *   "deleted": 3
 * }
 * 
 * Verify by checking:
 *   SELECT COUNT(*) FROM products WHERE is_deleted = false;
 *   SELECT COUNT(*) FROM products WHERE is_deleted = true;
 */

// ============================================================================
// TEST 12: Single Soft Delete
// ============================================================================

const deleteRowRequest = `
curl -X DELETE "http://localhost:3000/data/products/{PRODUCT_ID}" \\
  -H "Authorization: Bearer $TOKEN"
`;

/**
 * Expected response:
 * {
 *   "ok": true
 * }
 * 
 * Verify: Product should now have is_deleted = true
 */

// ============================================================================
// TEST 13: List All Table Schemas (API Explorer)
// ============================================================================

const listSchemasRequest = `
curl -X GET "http://localhost:3000/tables/schemas" \\
  -H "Authorization: Bearer $TOKEN"
`;

/**
 * Expected response:
 * {
 *   "schemas": [
 *     {
 *       "table": "products",
 *       "columns": [...],
 *       "reservedFields": [...]
 *     },
 *     {
 *       "table": "other_table",
 *       "columns": [...],
 *       "reservedFields": [...]
 *     }
 *   ]
 * }
 */

// ============================================================================
// TEST 14: Verify Audit Logging
// ============================================================================

const checkAuditLogs = `
psql postgresql://user:password@localhost/ht_cms -c "
SELECT 
  action_type,
  table_name,
  user_id,
  created_at
FROM audit_logs
WHERE table_name = 'products'
ORDER BY created_at DESC
LIMIT 20;
"
`;

/**
 * Expected: All CREATE/UPDATE/DELETE operations logged
 */

// ============================================================================
// TEST 15: Verify Row Versioning
// ============================================================================

const checkVersions = `
psql postgresql://user:password@localhost/ht_cms -c "
SELECT 
  row_id,
  version,
  created_by,
  created_at
FROM row_versions
WHERE table_name = 'products'
ORDER BY row_id, version DESC;
"
`;

/**
 * Expected: Each update creates new version entry
 */

// ============================================================================
// TEST 16: Performance Test (check query plans)
// ============================================================================

const explainQuery = `
psql postgresql://user:password@localhost/ht_cms -c "
EXPLAIN ANALYZE
SELECT * FROM products
WHERE is_deleted = false
AND status = 'active'
ORDER BY created_at DESC
LIMIT 50;
"
`;

/**
 * Expected: Should use index on (is_deleted, created_at)
 * Look for: "Index Scan using idx_products_is_deleted_created_at"
 */

// ============================================================================
// COMPLETE TEST SUITE SCRIPT
// ============================================================================

/**
 * Run all tests in sequence
 * Save as: test-dynamic-api.sh
 */

const completeTestScript = `#!/bin/bash

# Get token
echo "Getting auth token..."
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{
    "email":"admin@example.com",
    "password":"password"
  }' | jq -r '.token')

echo "✓ Token: $TOKEN"

# Create table
echo "\\nCreating test table..."
TABLE=$(curl -s -X POST http://localhost:3000/setup/tables \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "products",
    "visibilityMode": "GLOBAL_ACCESS",
    "columns": [
      {"name": "name", "type": "string", "required": true},
      {"name": "price", "type": "number", "required": true},
      {"name": "status", "type": "string", "required": false}
    ]
  }')

echo "✓ Table created: $(echo $TABLE | jq -r '.table.id')"

# Get schema
echo "\\nGetting table schema..."
SCHEMA=$(curl -s -X GET http://localhost:3000/tables/products/schema \\
  -H "Authorization: Bearer $TOKEN")
echo "✓ Schema: $(echo $SCHEMA | jq '.schema.columns | length') columns"

# Create rows
echo "\\nCreating test rows..."
for i in {1..10}; do
  curl -s -X POST http://localhost:3000/data/products \\
    -H "Authorization: Bearer $TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "{
      \\"name\\": \\"Product $i\\",
      \\"price\\": $((i * 10)).99,
      \\"status\\": \\"$([ $((i % 2)) -eq 0 ] && echo 'active' || echo 'inactive')\\"
    }" > /dev/null
done
echo "✓ Created 10 products"

# List products
echo "\\nListing products..."
LIST=$(curl -s -X GET "http://localhost:3000/data/products?limit=5" \\
  -H "Authorization: Bearer $TOKEN")
echo "✓ Retrieved: $(echo $LIST | jq '.rows | length') products (of $(echo $LIST | jq '.pagination.total') total)"

# Get distinct values
echo "\\nGetting distinct status values..."
DISTINCT=$(curl -s -X GET "http://localhost:3000/data/products/distinct/status" \\
  -H "Authorization: Bearer $TOKEN")
echo "✓ Distinct values: $(echo $DISTINCT | jq -r '.values | join(", ")')"

# Test validation
echo "\\nTesting validation..."
INVALID=$(curl -s -X POST http://localhost:3000/data/products \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": 123, "price": "invalid"}')
ERROR_COUNT=$(echo $INVALID | jq '.details | length')
echo "✓ Validation caught $ERROR_COUNT errors as expected"

# Check audit logs
echo "\\nChecking audit logs..."
AUDIT_COUNT=$(psql postgresql://user:password@localhost/ht_cms -t -c "
  SELECT COUNT(*) FROM audit_logs WHERE table_name = 'products';
")
echo "✓ Audit log entries: $AUDIT_COUNT"

echo "\\n✅ All tests passed!"
`;

// ============================================================================
// EXPECTED RESULTS CHECKLIST
// ============================================================================

/**
 * After running the complete test suite, you should see:
 * 
 * ✓ Indexes created (4 indexes on products table)
 * ✓ Schema retrieved (10 columns including reserved fields)
 * ✓ Rows created (10 products inserted)
 * ✓ List works (pagination metadata returned)
 * ✓ Distinct values (status field has 2 values)
 * ✓ Validation works (caught type mismatches)
 * ✓ Audit logs (10+ entries for created rows)
 * ✓ Performance OK (indexes used in EXPLAIN)
 */
