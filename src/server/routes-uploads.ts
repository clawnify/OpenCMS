import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { putUpload, getUpload } from "./uploads";

export function registerUploadRoutes(app: OpenAPIHono<{ Bindings: { DB: D1Database; UPLOADS: R2Bucket } }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/uploads",
      request: {
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({ file: z.any() }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: z.object({ url: z.string(), filename: z.string() }) } },
          description: "Uploaded",
        },
      },
    }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file") as File | null;
      if (!file) return c.json({ error: "No file" }, 400);
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const buffer = await file.arrayBuffer();
      const url = await putUpload(filename, buffer, file.type || "application/octet-stream");
      return c.json({ url, filename }, 200);
    },
  );

  app.get("/api/uploads/:filename", async (c) => {
    const filename = c.req.param("filename");
    const obj = await getUpload(filename);
    if (!obj) return c.notFound();
    return new Response(obj.data, {
      headers: {
        "Content-Type": obj.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
}
