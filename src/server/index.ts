import { OpenAPIHono } from "@hono/zod-openapi";
import { initDB } from "./db";
import { initUploads } from "./uploads";
import { registerPostRoutes } from "./routes-posts";
import { registerUploadRoutes } from "./routes-uploads";

type Env = { Bindings: { DB: D1Database; UPLOADS: R2Bucket } };

const app = new OpenAPIHono<Env>();

let schemaApplied = false;

app.use("*", async (c, next) => {
  initDB(c.env.DB);
  initUploads(c.env.UPLOADS);
  if (!schemaApplied) {
    await c.env.DB.exec(
      "CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT 'Untitled', slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '{\"type\":\"doc\",\"content\":[]}', image_url TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live')), featured INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', post_date TEXT NOT NULL DEFAULT (date('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));"
    );
    schemaApplied = true;
  }
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || String(err) }, 500);
});

registerPostRoutes(app);
registerUploadRoutes(app);

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { version: "1.0.0", title: "Open CMS API" },
});

export default app;
