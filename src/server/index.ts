import { OpenAPIHono } from "@hono/zod-openapi";
import { initDB } from "./db";
import { initUploads } from "./uploads";
import { registerUploadRoutes } from "./routes-uploads";
import { registerContentTypeRoutes } from "./routes-content-types";
import { registerEntryRoutes } from "./routes-entries";
import {
  ensureContentTypesTable,
  listContentTypes,
  seedBuiltInsIfMissing,
} from "./content-types";
import { syncTableToSchema } from "./schema-sync";

type Env = { Bindings: { DB: D1Database; UPLOADS: R2Bucket } };

const app = new OpenAPIHono<Env>();

let schemaApplied = false;

app.use("*", async (c, next) => {
  initDB(c.env.DB);
  initUploads(c.env.UPLOADS);
  if (!schemaApplied) {
    await ensureContentTypesTable(c.env.DB);
    await seedBuiltInsIfMissing();
    for (const ct of await listContentTypes()) {
      await syncTableToSchema(c.env.DB, ct);
    }
    schemaApplied = true;
  }
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || String(err) }, 500);
});

registerContentTypeRoutes(app);
registerEntryRoutes(app);
registerUploadRoutes(app);

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { version: "1.0.0", title: "Open CMS API" },
});

export default app;
