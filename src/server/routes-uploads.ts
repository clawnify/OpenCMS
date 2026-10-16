import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { putUpload, getUpload } from "./uploads";

const ErrorSchema = z.object({ error: z.string() });

export function registerUploadRoutes(app: OpenAPIHono<{ Bindings: { DB: D1Database; UPLOADS: R2Bucket } }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/uploads",
      description: "Upload a file. The returned `url` is this app's own serving path for it.",
      request: {
        body: {
          content: {
            "multipart/form-data": {
              // z.any() is what the form part validates as, but on its own it
              // publishes the field as `{}` — a generated client has no way to
              // know it takes a file. The openapi annotation is the standard
              // multipart spelling for one.
              schema: z.object({ file: z.any().openapi({ type: "string", format: "binary" }) }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: z.object({ url: z.string(), filename: z.string() }) } },
          description: "Uploaded",
        },
        400: {
          content: { "application/json": { schema: ErrorSchema } },
          description: "The file part is not a file",
        },
      },
    }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      // A text part named `file` satisfies z.any(), so the cast this guard
      // replaced let a string through to .arrayBuffer() and answered 500.
      if (!(file instanceof File)) return c.json({ error: "No file" }, 400);
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const buffer = await file.arrayBuffer();
      const url = await putUpload(filename, buffer, file.type || "application/octet-stream");
      return c.json({ url, filename }, 200);
    },
  );

  // Declared through `app.openapi` rather than a bare `app.get` so it reaches
  // /api/openapi.json: the upload response hands back a URL under this path, and
  // a client generated from the spec can only follow it if the spec says it
  // exists. The body is the stored file, so it is described as a media range
  // rather than a schema; the undescribed 404 is what lets the handler return
  // the raw Response the bytes need.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/uploads/{filename}",
      description: "Serve a stored file. The response carries the file's own content type.",
      request: { params: z.object({ filename: z.string() }) },
      responses: {
        200: {
          content: { "*/*": { schema: z.string().openapi({ format: "binary" }) } },
          description: "The file",
        },
        404: { description: "No such file" },
      },
    }),
    async (c) => {
      const filename = c.req.valid("param").filename;
      const obj = await getUpload(filename);
      if (!obj) return c.notFound();
      return new Response(obj.data, {
        headers: {
          "Content-Type": obj.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    },
  );
}
