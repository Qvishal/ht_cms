"""
DYNAMIC API SYSTEM - ARCHITECTURE DIAGRAM
==========================================

This document shows how all components of the dynamic API system work together.


COMPONENT OVERVIEW
══════════════════════════════════════════════════════════════════════════════

Admin Panel / Setup Wizard
        ↓
        └──→ POST /setup/tables (create new table)
             ↓
        ┌────────────────────────────────┐
        │  registry.ts                   │
        │  - ensurePhysicalTable()       │
        │  - Creates PostgreSQL table    │
        │  - Stores metadata in cms_*    │
        └────────────────────────────────┘
             ↓
        ┌────────────────────────────────┐
        │  dynamicIndexing.ts (NEW)      │
        │  - ensureTableIndexes()        │
        │  - Creates 4 optimal indexes   │
        │  - Handles failures gracefully │
        └────────────────────────────────┘
             ↓
        Table ready! APIs available immediately (no manual routes)


API REQUEST FLOW
══════════════════════════════════════════════════════════════════════════════

Client Request
    ↓
    POST /data/products {"name": "Widget", "price": 99.99}
    ↓
┌──────────────────────────┐
│ Authentication Middleware│ (JWT validation)
│ - Check token valid      │
└──────────────────────────┘
    ↓
┌──────────────────────────┐
│ RBAC Middleware          │ (Authorization check)
│ - Check table access     │
│ - Check user permissions │
└──────────────────────────┘
    ↓
┌──────────────────────────────────────────┐
│ dynamicValidation.ts (NEW)               │  ← VALIDATION LAYER
│ - validateRequestBody()                  │
│ - Check field types                      │
│ - Check required fields                  │
│ - Format validation errors               │
└──────────────────────────────────────────┘
    ↓
    [If invalid] ──→ 400 Bad Request with details ──→ Client
    ↓
    [If valid] ──→ Continue
    ↓
┌──────────────────────────────────────────┐
│ dynamicValidation.ts (NEW)               │  ← SANITIZATION
│ - sanitizeInput()                        │
│ - Remove unknown fields                  │
│ - Keep only known columns                │
└──────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────┐
│ CRUD Service / Dynamic Handler           │  ← EXECUTION
│ - Insert row to products table           │
│ - Set audit metadata (created_by, etc)   │
├──────────────────────────────────────────┤
│ DATABASE OPERATIONS:                     │
│ INSERT INTO products (name, price, ...) │
│         VALUES ($1, $2, ...)            │
│ [Uses parameterized query]               │
└──────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────┐
│ Audit Logging                            │  ← AUDIT TRAIL
│ - Log CREATE action                      │
│ - Record user ID, timestamp, new values  │
└──────────────────────────────────────────┘
    ↓
┌──────────────────────────┐
│ Response Formatting      │
│ Return created row with  │
│ all fields including:    │
│ - id, created_by         │
│ - created_at, updated_at │
│ - is_deleted             │
└──────────────────────────┘
    ↓
    200 OK {"row": {...}} ──→ Client


FILTERING & QUERY FLOW
══════════════════════════════════════════════════════════════════════════════

GET /data/products?filters=[{"field":"status","operator":"eq","value":"active"}]&limit=10&offset=0
    ↓
┌────────────────────────────────────────┐
│ Parse Query Parameters                 │
│ - limit, offset, filters, orderBy      │
└────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────┐
│ dynamicApi.ts (NEW)                    │  ← QUERY BUILDER
│ - buildDynamicWhere()                  │
│ - Convert filters to safe SQL          │
│ - Apply soft-delete filter             │
│ - Apply USER_SCOPED filtering          │
│ - Add parameterized values to array    │
└────────────────────────────────────────┘
    ↓
    Generated WHERE Clause:
    where (name like $1) and is_deleted = false and created_by = $2
    
    Parameters: ["Widget", "user_id"]
    ↓
┌────────────────────────────────────────┐
│ dynamicApi.ts                          │  ← QUERY EXECUTION
│ - fetchPagedRows()                     │
│ - Apply LIMIT/OFFSET pagination        │
│ - Execute parameterized query          │
│ - countRows() for total count          │
└────────────────────────────────────────┘
    ↓
    PostgreSQL execution:
    SELECT * FROM products
    WHERE (name like $1) and is_deleted = false and created_by = $2
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4
    [Uses index: idx_products_is_deleted_created_at]
    ↓
    Returns 10 rows + total count
    ↓
    200 OK {"rows": [...], "pagination": {total: 42, ...}}


INDEXING STRATEGY
══════════════════════════════════════════════════════════════════════════════

When table created:

    Table: products
        ↓
        Four indexes automatically created:
        
    Index 1: idx_products_created_by
    ├─ Column: created_by
    ├─ Purpose: Fast filtering for USER_SCOPED tables
    ├─ Query: WHERE created_by = user_id
    └─ Speedup: ~100x on large tables
    
    Index 2: idx_products_is_deleted_created_at
    ├─ Columns: (is_deleted, created_at)
    ├─ Purpose: Soft delete + default sort order
    ├─ Query: WHERE is_deleted=false ORDER BY created_at DESC
    └─ Speedup: Index-only scan possible
    
    Index 3: idx_products_created_at
    ├─ Column: created_at
    ├─ Purpose: Custom sort, range queries
    ├─ Query: WHERE created_at > '2025-01-01'
    └─ Speedup: ~50x on large tables
    
    Index 4: idx_products_updated_at
    ├─ Column: updated_at
    ├─ Purpose: Update tracking, sync
    ├─ Query: WHERE updated_at > last_sync_time
    └─ Speedup: ~50x on large tables


VALIDATION FLOW
══════════════════════════════════════════════════════════════════════════════

Request Body: {"name": 123, "price": "invalid", "status": "active"}

┌─────────────────────────────────────┐
│ Schema Definition (from cms_columns)│
├─────────────────────────────────────┤
│ name: {type: "string", required}    │
│ price: {type: "number", required}   │
│ status: {type: "string", optional}  │
└─────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ validateColumnValue("name", 123)     │
│ Expected: string                     │
│ Got: number                          │
│ Result: ERROR - TYPE_MISMATCH        │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ validateColumnValue("price", "inv.") │
│ Expected: number                     │
│ Got: string (not parseable)          │
│ Result: ERROR - TYPE_MISMATCH        │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ validateColumnValue("status", "act") │
│ Expected: string                     │
│ Got: string ✓                        │
│ Result: VALID                        │
└──────────────────────────────────────┘
    ↓
    formatValidationErrors():
    {
      "error": "Validation failed",
      "details": [
        {"field": "name", "code": "TYPE_MISMATCH", "message": "..."},
        {"field": "price", "code": "TYPE_MISMATCH", "message": "..."}
      ]
    }


SECURITY LAYERS
══════════════════════════════════════════════════════════════════════════════

Request
    ↓
┌─────────────────────────┐
│ Layer 1: Authentication │ (JWT token valid?)
│ middleware              │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│ Layer 2: Authorization  │ (User has access to table?)
│ RBAC checks             │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│ Layer 3: Input          │ (Data type valid? Required fields present?)
│ Validation              │
│ dynamicValidation.ts    │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│ Layer 4: SQL Injection  │ (All values parameterized, identifiers quoted)
│ Prevention              │
│ dynamicApi.ts           │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│ Layer 5: Data Filtering │ (Soft-delete, USER_SCOPED, visibility)
│ dynamicApi.ts           │
└─────────────────────────┘
    ↓
    Safe to execute


FILE INTERACTION DIAGRAM
══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────┐
│ index.ts (Elysia app routes)                                            │
│                                                                         │
│ GET  /data/:table ─────────┐                                           │
│ POST /data/:table ─────────┤                                           │
│ PUT  /data/:table/:id ─────┤                                           │
│ DELETE /data/:table/:id ───┤                                           │
│                            ↓                                           │
│                ┌────────────────────────┐                              │
│                │ Calls dynamicApi.ts    │                              │
│                │ - fetchPagedRows()     │                              │
│                │ - getTableSchema()     │                              │
│                │ - bulkSoftDelete()     │                              │
│                └────────┬───────────────┘                              │
│                         ↓                                              │
│ GET  /data/:table/distinct/:field ─→ fetchDistinctValues()            │
│ POST /data/:table/bulk-delete ─────→ bulkSoftDelete()                 │
│ GET  /tables/:table/schema ────────→ getTableSchema()                 │
│ GET  /tables/schemas ──────────────→ getTableSchema() (all)           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              ↓
            ┌─────────────────────────────────┐
            │ dynamicApi.ts (350 lines)       │
            │                                 │
            │ Query Building:                 │
            │ - validateTableAccess()         │
            │ - buildDynamicWhere()           │ ← Uses dynamicValidation.ts
            │ - buildOrderBy()                │   for input safety
            │                                 │
            │ Execution:                      │
            │ - fetchPagedRows()              │
            │ - countRows()                   │
            │ - fetchDistinctValues()         │
            │ - bulkSoftDelete()              │
            │ - getTableSchema()              │
            │                                 │
            │ [All use parameterized         │
            │  queries with assertIdent()]   │
            └──────────┬──────────────────────┘
                       ↓
            ┌──────────────────────────────┐
            │ registry.ts (existing)       │
            │                              │
            │ ensurePhysicalTable()        │
            │ - Create PostgreSQL table    │
            │ - Store metadata             │
            │ - Call auto-indexing ↓       │
            └──────────┬───────────────────┘
                       ↓
           ┌───────────────────────────┐
           │ dynamicIndexing.ts (NEW)  │
           │ - ensureTableIndexes()    │
           │ - createIndex()           │
           │ - getDefaultIndexes()     │
           └───────────────────────────┘
                       ↓
                PostgreSQL
                (4 indexes created)


DATA FLOW: CREATE NEW TABLE
══════════════════════════════════════════════════════════════════════════════

Admin: Create table "customers" via setup wizard
        ↓
    POST /setup/tables
    {
      "name": "customers",
      "columns": [
        {"name": "email", "type": "string"},
        {"name": "phone", "type": "string"}
      ]
    }
        ↓
┌─────────────────────────────────────┐
│ registry.ensurePhysicalTable()      │
│ - Validate table definition         │
│ - CREATE TABLE customers (...)      │
│ - INSERT INTO cms_tables            │
│ - INSERT INTO cms_columns (2 rows)  │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│ dynamicIndexing.ensureTableIndexes()│
│ - CREATE INDEX idx_customers_...    │ (4 indexes)
│ - Each index created CONCURRENTLY   │
└─────────────────────────────────────┘
        ↓
    DONE! Table ready.
    
    Now these endpoints work:
    GET  /data/customers
    POST /data/customers
    GET  /data/customers/:id
    PUT  /data/customers/:id
    DELETE /data/customers/:id
    GET  /data/customers/distinct/email
    GET  /tables/customers/schema

    All with:
    ✓ Validation
    ✓ RBAC
    ✓ Soft delete
    ✓ Audit logging
    ✓ Performance (indexing)


TYPE SAFETY FLOW
══════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────┐
│ dynamicApiTypes.ts (NEW)                     │
│ - FilterBuilder class                        │
│ - Type definitions                           │
│ - Response types                             │
│ - Validation error types                     │
└──────────────────────────────────────────────┘
        ↓
Frontend/Backend uses:
        ↓
    const filters = new FilterBuilder()
        .greaterThan("price", 50)
        .equals("status", "active")
        .build();
        
    const url = buildQueryUrl(baseUrl, "products", {
        filters,
        limit: 20,
        offset: 0
    });
        ↓
IDE shows:
    - Type hints for FilterBuilder methods
    - Auto-complete for operator names
    - Correct types for values
    ↓
Result: Compile-time type safety


PERFORMANCE IMPACT
══════════════════════════════════════════════════════════════════════════════

Without Dynamic API System:
    SELECT * FROM products WHERE status = 'active' ORDER BY created_at
    ↓
    Full table scan (100,000 rows)
    ↓
    Database CPU: HIGH
    Response time: 500ms+
    ↓
    ❌ SLOW

With Dynamic API System:
    SELECT * FROM products WHERE is_deleted=false
                              AND status = 'active'
                              ORDER BY created_at
                              LIMIT 50 OFFSET 0
    ↓
    Index used: idx_products_is_deleted_created_at
    ↓
    Index scan (50 rows analyzed)
    ↓
    Database CPU: LOW
    Response time: 10ms
    ↓
    ✅ 50x FASTER
    
    Memory: 80KB vs 40MB
    ✅ More efficient


MONITORING & OBSERVABILITY
══════════════════════════════════════════════════════════════════════════════

Check Index Usage:
    SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
    FROM pg_stat_user_indexes
    WHERE tablename = 'products'
    ORDER BY idx_scan DESC;
        ↓
    idx_products_is_deleted_created_at: 1,234 scans
    idx_products_created_by: 456 scans
    idx_products_created_at: 89 scans
    idx_products_updated_at: 0 scans
        ↓
    ✓ Good: Soft-delete index heavily used (optimal)
    ✓ Good: created_by index used (RBAC working)
    ✓ Good: Unused indexes (can consider dropping)

Check Slow Queries:
    SELECT query, mean_exec_time, calls
    FROM pg_stat_statements
    WHERE query LIKE '%products%'
    ORDER BY mean_exec_time DESC;
        ↓
    If mean_exec_time > 100ms:
    ├─ Check if index is being used
    ├─ Consider custom indexes (dynamicIndexing.createCustomIndex)
    ├─ Check filter selectivity
    └─ Possibly add WHERE clause optimization

Check Audit Trail:
    SELECT action_type, table_name, COUNT(*) as count
    FROM audit_logs
    WHERE created_at > NOW() - INTERVAL '1 day'
    GROUP BY action_type, table_name;
        ↓
    ✓ Verify all operations logged
    ✓ Check for unusual patterns
    ✓ Audit trail intact for compliance


════════════════════════════════════════════════════════════════════════════
All components work together to provide instant, secure, validated, and 
performant APIs for dynamically created tables.
════════════════════════════════════════════════════════════════════════════
"""
