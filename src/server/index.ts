import { createApp } from "@clawnify/app";
import { cors } from "hono/cors";
import { initUploads } from "./uploads";
import { registerUploadRoutes } from "./routes-uploads";
import { registerContentTypeRoutes } from "./routes-content-types";
import { registerEntryRoutes } from "./routes-entries";
import {
  listContentTypes,
  migrateMediaToImage,
  seedBuiltInsIfMissing,
} from "./content-types";
import { syncTableToSchema } from "./schema-sync";
import { registerAIRoutes } from "./routes-ai";

type Env = {
  Bindings: { DB: D1Database; UPLOADS: R2Bucket; OPENROUTER_API_KEY?: string };
};

const app = createApp<Env>({ title: "Open CMS API", version: "1.0.0" });

// The read API is public (see clawnify.json public_routes) and meant to be
// consumed cross-origin by external tools — Framer/AnySync, Zapier, sites.
// Browsers block those fetches without CORS headers, so allow any origin to
// read. Writes are issued same-origin from this app's own UI, so they need no
// CORS; cross-origin writes stay blocked (only GET is allowed cross-origin).
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    maxAge: 86400,
  }),
);

let schemaApplied = false;

app.use("*", async (c, next) => {
  initUploads(c.env.UPLOADS);
  if (!schemaApplied) {
    // content_types itself is provisioned by src/server/schema.sql at
    // deploy time. The per-collection tables get bootstrapped here
    // because their definitions live in rows, not in the static schema.
    await migrateMediaToImage();
    await seedBuiltInsIfMissing();
    for (const ct of await listContentTypes()) {
      await syncTableToSchema(ct);
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
registerAIRoutes(app);

export default app;
