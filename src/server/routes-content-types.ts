/**
 * Content-type builder REST.
 *
 *   GET    /api/content-types
 *   GET    /api/content-types/:uid
 *   POST   /api/content-types
 *   PATCH  /api/content-types/:uid
 *   DELETE /api/content-types/:uid          (drops the underlying table too)
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  ContentType,
  deleteContentType,
  getContentType,
  listContentTypes,
  upsertContentType,
} from "./content-types";
import { applyDestructive, syncTableToSchema } from "./schema-sync";

const ContentTypeSchema = z.object({
  uid: z.string(),
  kind: z.enum(["collectionType", "singleType"]),
  collectionName: z.string(),
  info: z.object({
    singularName: z.string(),
    pluralName: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
  }),
  options: z.record(z.string(), z.any()).default({}),
  attributes: z.record(z.string(), z.any()),
  created_at: z.string(),
  updated_at: z.string(),
});

const ContentTypeInputSchema = z.object({
  contentType: z.object({
    uid: z.string().regex(/^api::[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
    kind: z.enum(["collectionType", "singleType"]).default("collectionType"),
    collectionName: z.string().regex(/^[a-z][a-z0-9_]*$/),
    info: z.object({
      singularName: z.string(),
      pluralName: z.string(),
      displayName: z.string(),
      description: z.string().optional(),
    }),
    options: z.record(z.string(), z.any()).default({}),
    attributes: z.record(z.string(), z.any()).default({}),
  }),
});

const PatchSchema = z.object({
  info: z
    .object({
      singularName: z.string().optional(),
      pluralName: z.string().optional(),
      displayName: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  options: z.record(z.string(), z.any()).optional(),
  attributes: z.record(z.string(), z.any()).optional(),
  /** Set true to apply destructive ops (DROP COLUMN). Defaults false. */
  applyDestructive: z.boolean().optional(),
});

const ErrorSchema = z.object({ error: z.string() });

type Bindings = { DB: D1Database; UPLOADS: R2Bucket };

export function registerContentTypeRoutes(app: OpenAPIHono<{ Bindings: Bindings }>) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/content-types",
      responses: {
        200: { content: { "application/json": { schema: z.array(ContentTypeSchema) } }, description: "List" },
      },
    }),
    async (c) => c.json(await listContentTypes(), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/content-types/{uid}",
      request: { params: z.object({ uid: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: ContentTypeSchema } }, description: "OK" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { uid } = c.req.valid("param");
      const ct = await getContentType(uid);
      if (!ct) return c.json({ error: "Not found" }, 404);
      return c.json(ct, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/content-types",
      request: { body: { content: { "application/json": { schema: ContentTypeInputSchema } } } },
      responses: {
        200: { content: { "application/json": { schema: ContentTypeSchema } }, description: "Created" },
        409: { content: { "application/json": { schema: ErrorSchema } }, description: "UID exists" },
      },
    }),
    async (c) => {
      const { contentType } = c.req.valid("json");
      const existing = await getContentType(contentType.uid);
      if (existing) return c.json({ error: `UID ${contentType.uid} already exists` }, 409);
      await upsertContentType(contentType as Omit<ContentType, "created_at" | "updated_at">);
      const saved = await getContentType(contentType.uid);
      await syncTableToSchema(c.env.DB, saved!);
      return c.json(saved!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/content-types/{uid}",
      request: {
        params: z.object({ uid: z.string() }),
        body: { content: { "application/json": { schema: PatchSchema } } },
      },
      responses: {
        200: { content: { "application/json": { schema: ContentTypeSchema } }, description: "Updated" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { uid } = c.req.valid("param");
      const patch = c.req.valid("json");
      const existing = await getContentType(uid);
      if (!existing) return c.json({ error: "Not found" }, 404);

      const next: ContentType = {
        ...existing,
        info: { ...existing.info, ...(patch.info ?? {}) },
        options: { ...existing.options, ...(patch.options ?? {}) },
        attributes: patch.attributes ?? existing.attributes,
      };
      await upsertContentType(next);
      await syncTableToSchema(c.env.DB, next);
      if (patch.applyDestructive) await applyDestructive(c.env.DB, next);
      return c.json((await getContentType(uid))!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/content-types/{uid}",
      request: { params: z.object({ uid: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Deleted" },
      },
    }),
    async (c) => {
      const { uid } = c.req.valid("param");
      const ct = await getContentType(uid);
      if (ct) {
        await c.env.DB.exec(`DROP TABLE IF EXISTS "${ct.collectionName.replace(/"/g, '""')}"`);
        await deleteContentType(uid);
      }
      return c.json({ ok: true }, 200);
    },
  );
}
