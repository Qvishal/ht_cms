/**
 * DYNAMIC API SYSTEM - INTEGRATION GUIDE
 * 
 * This document explains how the dynamic API system works and how to use it.
 * 
 * ============================================================================
 * OVERVIEW
 * ============================================================================
 * 
 * The dynamic API system enables automatic CRUD APIs for any table without
 * manual route creation. When a new table is created, these endpoints become
 * instantly available:
 * 
 *   GET    /data/:table           - List rows
 *   GET    /data/:table/:id       - Get single row
 *   POST   /data/:table           - Create row
 *   PUT    /data/:table/:id       - Update row
 *   DELETE /data/:table/:id       - Soft delete row
 *   POST   /data/:table/:id/restore - Restore deleted row (admin only)
 * 
 * ============================================================================
 * QUERY PARAMETERS & REQUEST BODY FORMAT
 * ============================================================================
 * 
 * LIST ROWS (GET /data/:table)
 * 
 *   Query Parameters:
 *   - limit (int, 1-200, default 50): Number of rows to fetch
 *   - offset (int, default 0): Pagination offset
 *   - orderBy (string): Column to order by (default: created_at)
 *   - ascending (boolean): Sort direction (default: false/descending)
 *   - search (JSON): Full-text search filters
 *   - filters (JSON): Advanced filters
 *   - includeDeleted (boolean): Include soft-deleted rows (admin only)
 * 
 *   Example:
 *   GET /data/products?limit=20&offset=0&orderBy=created_at&ascending=false
 * 
 * 
 * GET SINGLE ROW (GET /data/:table/:id)
 * 
 *   Path Parameters:
 *   - table: Table name
 *   - id: Row ID (UUID)
 * 
 *   Query Parameters:
 *   - includeDeleted (boolean): Include deleted row (admin only)
 * 
 *   Example:
 *   GET /data/products/550e8400-e29b-41d4-a716-446655440000
 * 
 * 
 * CREATE ROW (POST /data/:table)
 * 
 *   Body: JSON object with column values
 *   
 *   Example:
 *   POST /data/products
 *   {
 *     "name": "Widget",
 *     "price": 29.99,
 *     "in_stock": true,
 *     "metadata": "{\"sku\": \"ABC123\"}"
 *   }
 * 
 *   Response:
 *   {
 *     "row": {
 *       "id": "550e8400-e29b-41d4-a716-446655440000",
 *       "name": "Widget",
 *       "price": 29.99,
 *       "in_stock": true,
 *       "metadata": "{\"sku\": \"ABC123\"}",
 *       "created_by": "user_id",
 *       "created_at": "2025-04-05T10:30:00Z",
 *       "updated_at": "2025-04-05T10:30:00Z",
 *       "is_deleted": false
 *     }
 *   }
 * 
 * 
 * UPDATE ROW (PUT /data/:table/:id)
 * 
 *   Body: JSON object with fields to update (partial update)
 *   
 *   Example:
 *   PUT /data/products/550e8400-e29b-41d4-a716-446655440000
 *   {
 *     "price": 39.99,
 *     "in_stock": false
 *   }
 * 
 *   Response: Updated row object
 * 
 * 
 * SOFT DELETE ROW (DELETE /data/:table/:id)
 * 
 *   Example:
 *   DELETE /data/products/550e8400-e29b-41d4-a716-446655440000
 * 
 *   Response:
 *   { "ok": true }
 * 
 * 
 * RESTORE ROW (POST /data/:table/:id/restore)
 * 
 *   Admin only. Restores a soft-deleted row.
 * 
 *   Example:
 *   POST /data/products/550e8400-e29b-41d4-a716-446655440000/restore
 * 
 *   Response: Restored row object
 * 
 * ============================================================================
 * ADVANCED FILTERING
 * ============================================================================
 * 
 * The dynamic API supports advanced filtering via query parameters:
 * 
 *   GET /data/products?filters={"operator":"eq","field":"status","value":"active"}
 * 
 * Supported Operators:
 *   - eq        : Equals
 *   - neq       : Not equals
 *   - gt        : Greater than
 *   - lt        : Less than
 *   - like      : Contains (case-insensitive)
 *   - in        : In array
 * 
 * Example with multiple filters:
 *   GET /data/products?filters=[
 *     {"field":"status","operator":"eq","value":"active"},
 *     {"field":"price","operator":"gt","value":10}
 *   ]
 * 
 * ============================================================================
 * FEATURES
 * ============================================================================
 * 
 * 1. ROLE-BASED ACCESS CONTROL (RBAC)
 *    - Admins can access any table with full permissions
 *    - Regular users can only access tables assigned to them
 *    - Check /tables/access to see user's permissions
 * 
 * 2. DATA VISIBILITY MODES
 *    - GLOBAL_ACCESS: User sees all rows
 *    - USER_SCOPED: User sees only their own rows (created_by filter)
 * 
 * 3. SOFT DELETE
 *    - DELETE marks rows as deleted, doesn't remove them
 *    - Rows are hidden by default (includeDeleted=false)
 *    - Admins can restore deleted rows
 * 
 * 4. AUDIT LOGS
 *    - All CRUD operations are logged with:
 *      - User ID
 *      - Action (CREATE, UPDATE, DELETE)
 *      - Old and new values
 *      - Timestamp
 * 
 * 5. ROW VERSIONING
 *    - All updates create a version entry
 *    - GET /versions/:table/:id lists all versions
 *    - Each version stores the full previous state
 * 
 * 6. AUTOMATIC INDEXING
 *    - Tables automatically get indexes on:
 *      - created_by (for USER_SCOPED filtering)
 *      - is_deleted + created_at (soft delete + sorting)
 *      - created_at and updated_at (default ordering)
 * 
 * 7. SCHEMA VALIDATION
 *    - All inputs validated against column types
 *    - Rejects invalid types, missing required fields
 *    - Returns detailed validation errors
 * 
 * ============================================================================
 * EXAMPLE: CREATE A TABLE AND USE IT
 * ============================================================================
 * 
 * Step 1: Admin creates table schema
 * 
 *   POST /schema/apply
 *   {
 *     "tables": [
 *       {
 *         "name": "blog_posts",
 *         "columns": [
 *           { "name": "title", "type": "string", "required": true },
 *           { "name": "content", "type": "text", "required": true },
 *           { "name": "published", "type": "boolean", "required": false },
 *           { "name": "tags", "type": "text", "required": false }
 *         ]
 *       }
 *     ]
 *   }
 * 
 * Step 2: Backend automatically:
 *   - Creates the physical PostgreSQL table
 *   - Registers the table in cms_tables and cms_columns
 *   - Creates optimal indexes
 *   - Sets visibility mode (default: GLOBAL_ACCESS)
 * 
 * Step 3: APIs are instantly available!
 * 
 *   # List posts
 *   GET /data/blog_posts
 * 
 *   # Create post
 *   POST /data/blog_posts
 *   { "title": "Hello World", "content": "...", "published": true }
 * 
 *   # Update post
 *   PUT /data/blog_posts/550e8400-e29b-41d4-a716-446655440000
 *   { "published": false }
 * 
 *   # Delete post
 *   DELETE /data/blog_posts/550e8400-e29b-41d4-a716-446655440000
 * 
 * ============================================================================
 * SECURITY CONSIDERATIONS
 * ============================================================================
 * 
 * 1. SQL INJECTION PREVENTION
 *    - All table/column names validated with assertIdent()
 *    - All values use parameterized queries
 *    - Names quoted with quoteIdent() for safety
 * 
 * 2. AUTHORIZATION
 *    - All requests require valid JWT token
 *    - Table access checked via RBAC middleware
 *    - Admin operations restricted to admin users
 * 
 * 3. DATA FILTERING
 *    - USER_SCOPED tables automatically filtered by created_by
 *    - Soft-deleted rows excluded by default
 *    - Admins can opt-in to see deleted rows
 * 
 * 4. VALIDATION
 *    - Request bodies validated against schema
 *    - Type mismatches rejected with clear errors
 *    - Unknown fields ignored silently
 * 
 * ============================================================================
 * PERFORMANCE OPTIMIZATION
 * ============================================================================
 * 
 * 1. AUTOMATIC INDEXES
 *    - Tables indexed on common filter/join columns
 *    - Queries on created_by, is_deleted, created_at optimized
 * 
 * 2. PAGINATION
 *    - Always paginate large result sets (limit 50-200)
 *    - Use offset for pagination, avoid fetching all rows
 * 
 * 3. FILTERING
 *    - Use filters to reduce result set before sorting
 *    - Avoid full table scans; use indexed columns
 * 
 * 4. QUERY PATTERNS
 *    - SELECT * queries optimized for 200-row limit
 *    - COUNT(*) queries optimized with indexes
 *    - Soft delete index enables efficient filtering
 * 
 * ============================================================================
 * INTEGRATION CHECKLIST
 * ============================================================================
 * 
 * [x] Dynamic API Router implemented
 * [x] Validation middleware created
 * [x] Automatic indexing service added
 * [x] Query builder with parameterized queries
 * [x] RBAC and permissions integrated
 * [x] Soft delete implemented
 * [x] Audit logging implemented
 * [x] Row versioning implemented
 * [x] API documentation exposed
 * [ ] Frontend integration (query builder UI)
 * [ ] API client library (if needed)\n * [ ] Performance monitoring/metrics
 * 
 * To enable new features:
 * 
 * 1. Update registry.ts ensurePhysicalTable() to call ensureTableIndexes()
 * 2. Replace CRUD validation with validateRequestBody() from dynamicValidation.ts
 * 3. Add advanced filtering routes using dynamicApi.ts
 * 4. Add API schema endpoint that calls getTableSchema()
 */

export const INTEGRATION_GUIDE = "";
