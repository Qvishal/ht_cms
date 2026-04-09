import { Elysia } from "elysia";
import { getTables, getColumns } from "../services/registry";
import { getVisibilityMode } from "../services/tableMetadata";

function mapType(type: string) {
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  return "string";
}

export const dynamicSwaggerRoutes = new Elysia({ prefix: "/api-docs" })
  .get("/json", async ({ request }) => {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const tables = await getTables();

    const paths: Record<string, any> = {};
    const schemas: Record<string, any> = {};

    for (const table of tables) {
      const columns = await getColumns(table, true);
      const properties: Record<string, any> = {};
      const requiredCols: string[] = [];

      properties["id"] = { type: "string" };
      properties["created_at"] = { type: "string", format: "date-time" };
      properties["updated_at"] = { type: "string", format: "date-time" };

      for (const col of columns) {
        if (col.active === false) continue;
        properties[col.name] = { type: mapType(col.type) };
        if (col.required) requiredCols.push(col.name);
      }

      schemas[table] = {
        type: "object",
        properties,
      };

      const createProperties: Record<string, any> = {};
      for (const col of columns) {
        if (col.active === false) continue;
        createProperties[col.name] = { type: mapType(col.type) };
      }

      schemas[`${table}Input`] = {
        type: "object",
        properties: createProperties,
        required: requiredCols.length ? requiredCols : undefined,
      };

      const visibilityMode = await getVisibilityMode(table);

      if (visibilityMode === "GLOBAL_ACCESS") {
        // Public APIs
        paths[`/api/public/${table}`] = {
          get: {
            tags: [`Public ${table}`],
            summary: `List public ${table}`,
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: { type: "number", default: 50 },
              },
              {
                name: "offset",
                in: "query",
                schema: { type: "number", default: 0 },
              },
            ],
            responses: {
              "200": {
                description: "Successful response",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        rows: {
                          type: "array",
                          items: { $ref: `#/components/schemas/${table}` },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };

        paths[`/api/public/${table}/{id}`] = {
          get: {
            tags: [`Public ${table}`],
            summary: `Get public ${table} by ID`,
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Successful response",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        row: { $ref: `#/components/schemas/${table}` },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }

      // Private APIs
      paths[`/data/${table}`] = {
        get: {
          tags: [`Private ${table}`],
          summary: `List private ${table}`,
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "number", default: 50 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "number", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      rows: {
                        type: "array",
                        items: { $ref: `#/components/schemas/${table}` },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: [`Private ${table}`],
          summary: `Create private ${table}`,
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${table}Input` },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      row: { $ref: `#/components/schemas/${table}` },
                    },
                  },
                },
              },
            },
          },
        },
      };

      paths[`/data/${table}/{id}`] = {
        get: {
          tags: [`Private ${table}`],
          summary: `Get private ${table} by ID`,
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      row: { $ref: `#/components/schemas/${table}` },
                    },
                  },
                },
              },
            },
          },
        },
        put: {
          tags: [`Private ${table}`],
          summary: `Update private ${table}`,
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${table}Input` },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      row: { $ref: `#/components/schemas/${table}` },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: [`Private ${table}`],
          summary: `Delete private ${table}`,
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Successful response" },
          },
        },
      };
    }

    // Add Token Generation API to easily test private routes
    paths["/auth/login"] = {
      post: {
        tags: ["Authentication"],
        summary: "Login to generate JWT token",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password" },
                },
                required: ["email", "password"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful login returns JWT token",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    user: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        email: { type: "string" },
                        role: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid credentials" },
        },
      },
    };

    return {
      openapi: "3.0.0",
      info: { title: "Admin Tables Generated API", version: "1.0.0" },
      servers: [{ url: baseUrl }],
      paths,
      components: {
        schemas,
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    };
  })
  .get("/ui", () => {
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Dynamic Tables Swagger Interface</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api-docs/json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
      });
    </script>
  </body>
</html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  });
