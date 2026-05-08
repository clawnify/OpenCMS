import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { query, get, run } from "./db";

const PostSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  content: z.string(),
  image_url: z.string().nullable(),
  status: z.enum(["draft", "live"]),
  featured: z.number(),
  category: z.string(),
  author: z.string(),
  post_date: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const PostPatchSchema = z.object({
  title: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  image_url: z.string().nullable().optional(),
  status: z.enum(["draft", "live"]).optional(),
  featured: z.number().optional(),
  category: z.string().optional(),
  author: z.string().optional(),
  post_date: z.string().optional(),
});

const ErrorSchema = z.object({ error: z.string() });

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "untitled";
}

async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let candidate = base;
  let n = 2;
  while (true) {
    const row = await get<{ id: number }>(
      "SELECT id FROM posts WHERE slug = ? AND id IS NOT ?",
      [candidate, excludeId ?? -1],
    );
    if (!row) return candidate;
    candidate = `${base}-${n++}`;
  }
}

export function registerPostRoutes(app: OpenAPIHono<{ Bindings: { DB: D1Database; UPLOADS: R2Bucket } }>) {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/posts",
      responses: {
        200: { content: { "application/json": { schema: z.array(PostSchema) } }, description: "List posts" },
      },
    }),
    async (c) => {
      const rows = await query<z.infer<typeof PostSchema>>(
        "SELECT * FROM posts ORDER BY post_date DESC, id DESC",
      );
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/posts/{id}",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: PostSchema } }, description: "Get post" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const row = await get<z.infer<typeof PostSchema>>("SELECT * FROM posts WHERE id = ?", [id]);
      if (!row) return c.json({ error: "Not found" }, 404);
      return c.json(row, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/posts",
      request: {
        body: {
          content: { "application/json": { schema: z.object({ title: z.string().optional() }) } },
        },
      },
      responses: {
        200: { content: { "application/json": { schema: PostSchema } }, description: "Created" },
      },
    }),
    async (c) => {
      const { title } = c.req.valid("json");
      const finalTitle = (title?.trim() || "Untitled");
      const slug = await uniqueSlug(slugify(finalTitle));
      const result = await run(
        "INSERT INTO posts (title, slug) VALUES (?, ?)",
        [finalTitle, slug],
      );
      const row = await get<z.infer<typeof PostSchema>>(
        "SELECT * FROM posts WHERE id = ?",
        [result.lastInsertRowid],
      );
      return c.json(row!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/posts/{id}",
      request: {
        params: z.object({ id: z.string() }),
        body: { content: { "application/json": { schema: PostPatchSchema } } },
      },
      responses: {
        200: { content: { "application/json": { schema: PostSchema } }, description: "Updated" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const existing = await get<z.infer<typeof PostSchema>>("SELECT * FROM posts WHERE id = ?", [id]);
      if (!existing) return c.json({ error: "Not found" }, 404);

      const sets: string[] = [];
      const params: unknown[] = [];

      if (body.slug !== undefined && body.slug !== existing.slug) {
        const s = await uniqueSlug(slugify(body.slug), Number(id));
        sets.push("slug = ?"); params.push(s);
      } else if (body.title !== undefined && body.title !== existing.title && existing.slug === slugify(existing.title)) {
        const s = await uniqueSlug(slugify(body.title), Number(id));
        sets.push("slug = ?"); params.push(s);
      }
      for (const key of ["title", "description", "content", "image_url", "status", "featured", "category", "author", "post_date"] as const) {
        if (body[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(body[key]);
        }
      }
      sets.push("updated_at = datetime('now')");
      params.push(id);
      await run(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`, params);

      const row = await get<z.infer<typeof PostSchema>>("SELECT * FROM posts WHERE id = ?", [id]);
      return c.json(row!, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/posts/{id}",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Deleted" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      await run("DELETE FROM posts WHERE id = ?", [id]);
      return c.json({ ok: true }, 200);
    },
  );
}
