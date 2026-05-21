/**
 * AI generation endpoint — produces a value for one field of one entry
 * using the column's per-attribute `aiConfig.systemPrompt`, with
 * `{{key}}` references interpolated against the row's current values.
 *
 *   POST /api/ai/generate-field
 *     { pluralName, entryId, fieldKey }  →  { value }
 *
 * The persisted update is the caller's job — this route just returns
 * the produced value so the client can flow it through the existing
 * debounced PATCH path and see optimistic updates.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { get } from "./db";
import {
  type Attribute,
  getContentTypeByPluralName,
} from "./content-types";
import {
  generateHtml,
  generateImage,
  generateText,
  interpolate,
} from "./ai";

const ErrorSchema = z.object({ error: z.string() });
const ResultSchema = z.object({ value: z.any() });

type Bindings = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  OPENROUTER_API_KEY?: string;
};

function quote(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

function coerceForAttr(raw: string, attr: Attribute): unknown {
  switch (attr.type) {
    case "integer": {
      const n = parseInt(raw.match(/-?\d+/)?.[0] || "", 10);
      return Number.isFinite(n) ? n : null;
    }
    case "decimal": {
      const n = parseFloat(raw.match(/-?\d+(\.\d+)?/)?.[0] || "");
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      return /^(true|yes|y|1)\b/i.test(raw.trim());
    }
    case "date": {
      const m = raw.match(/\d{4}-\d{2}-\d{2}/);
      return m ? m[0] : null;
    }
    case "datetime": {
      const m = raw.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/);
      return m ? m[0] : null;
    }
    case "enumeration": {
      const enums = ("enum" in attr ? attr.enum : []) as string[];
      const lower = raw.trim().toLowerCase();
      const match = enums.find((e) => e.toLowerCase() === lower)
        || enums.find((e) => lower.includes(e.toLowerCase()));
      return match || enums[0] || null;
    }
    default:
      return raw;
  }
}

export function registerAIRoutes(app: OpenAPIHono<{ Bindings: Bindings }>) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/ai/generate-field",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                pluralName: z.string(),
                entryId: z.union([z.number(), z.string()]),
                fieldKey: z.string(),
              }),
            },
          },
        },
      },
      responses: {
        200: { content: { "application/json": { schema: ResultSchema } }, description: "Generated" },
        400: { content: { "application/json": { schema: ErrorSchema } }, description: "Bad input or not configured" },
        404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
        502: { content: { "application/json": { schema: ErrorSchema } }, description: "Upstream error" },
      },
    }),
    async (c) => {
      const apiKey = c.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return c.json({ error: "AI not configured (OPENROUTER_API_KEY missing)" }, 400);
      }
      const { pluralName, entryId, fieldKey } = c.req.valid("json");

      const ct = await getContentTypeByPluralName(pluralName);
      if (!ct) return c.json({ error: "Library not found" }, 404);
      const attr = ct.attributes[fieldKey];
      if (!attr) return c.json({ error: `Unknown field: ${fieldKey}` }, 404);
      if (!attr.aiConfig?.enabled) {
        return c.json({ error: `Field ${fieldKey} has no AI config` }, 400);
      }

      const row = await get<Record<string, unknown>>(
        `SELECT * FROM ${quote(ct.collectionName)} WHERE id = ?`,
        [entryId],
      );
      if (!row) return c.json({ error: "Entry not found" }, 404);

      const interpolatedPrompt = interpolate(attr.aiConfig.systemPrompt, row);

      // Compose extra context block listing other column values so the model
      // can use them even when the user didn't write explicit {{refs}}.
      const otherFields = Object.entries(row)
        .filter(([k]) => k !== fieldKey && k !== "id" && k !== "created_at" && k !== "updated_at")
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n");

      const systemPrompt = otherFields
        ? `${interpolatedPrompt}\n\nRow context:\n${otherFields}`
        : interpolatedPrompt;

      try {
        let value: unknown;
        if (attr.type === "image") {
          value = await generateImage({
            apiKey,
            model: attr.aiConfig.model,
            systemPrompt,
          });
        } else if (attr.type === "html") {
          value = await generateHtml({
            apiKey,
            model: attr.aiConfig.model,
            systemPrompt,
          });
        } else {
          const raw = await generateText({
            apiKey,
            model: attr.aiConfig.model,
            systemPrompt,
          });
          value = coerceForAttr(raw, attr);
        }
        return c.json({ value }, 200);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
    },
  );
}
