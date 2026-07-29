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
  type ContentType,
  getContentTypeByPluralName,
} from "./content-types";
import {
  generateHtml,
  generateImage,
  generateText,
  interpolate,
} from "./ai";
import { NOTES_COLUMN } from "./schema-sync";

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

/** "post_date" → "Post date", "metaTitle" → "Meta title". */
function humanizeKey(key: string): string {
  const s = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the system prompt for one field generation. Always states what field
 * is being produced, its type/constraints, and the rest of the row as context,
 * so generation is sensible even when the user left the AI prompt blank. Any
 * user-authored prompt is layered on top as additional instructions.
 */
function buildSystemPrompt(args: {
  fieldKey: string;
  attr: Attribute;
  contentType: ContentType;
  customInstructions: string;
  notes: string;
  otherFields: string;
}): string {
  const { fieldKey, attr, contentType, customInstructions, notes, otherFields } = args;
  const label = humanizeKey(fieldKey);
  const recordName =
    contentType.info.singularName || contentType.info.displayName || "record";

  const lines: string[] = [
    `You are filling in a CMS. Generate the value for the "${label}" field of a "${recordName}" record.`,
  ];

  switch (attr.type) {
    case "enumeration": {
      const enums = ("enum" in attr ? attr.enum : []) as string[];
      if (enums.length) {
        lines.push(
          `This field must be exactly one of these values: ${enums.join(", ")}. Respond with only one of them.`,
        );
      }
      break;
    }
    case "integer":
      lines.push("This field is an integer. Respond with a single whole number and nothing else.");
      break;
    case "decimal":
      lines.push("This field is a number. Respond with a single number and nothing else.");
      break;
    case "boolean":
      lines.push('This field is a yes/no boolean. Respond with only "true" or "false".');
      break;
    case "date":
      lines.push("This field is a date. Respond with only an ISO date (YYYY-MM-DD).");
      break;
    case "datetime":
      lines.push("This field is a datetime. Respond with only an ISO datetime (YYYY-MM-DDTHH:MM).");
      break;
    case "image":
      lines.push(`Generate an image suitable for the "${label}" of this ${recordName}.`);
      break;
    case "html":
      lines.push(`Generate an HTML fragment for the "${label}" of this ${recordName}.`);
      break;
    default:
      lines.push(
        `Respond with a concise, appropriate value for "${label}" — just the value itself, with no field name, quotes, or explanation.`,
      );
  }

  // The author's brief outranks everything else that follows: it is the one
  // input carrying a point of view and lived detail, and generic output is
  // exactly what it exists to prevent.
  //
  // Image fields are the exception. This whole block goes to the image model as
  // the user message, and a brief written for prose ("be blunt", "mention the
  // €400/mo saving") reads to it as instructions to render — the reliable way to
  // get stray text baked into the picture. Images get the notes as subject
  // matter only.
  if (notes.trim() && attr.type === "image") {
    lines.push(
      "",
      "Context for the subject, from the author's notes — use it to decide what to depict. " +
        "Do not render any of this text in the image:",
      notes.trim(),
    );
  } else if (notes.trim()) {
    lines.push(
      "",
      "The author's notes for this entry — their own brief, in their own words:",
      notes.trim(),
      "",
      "Treat these notes as the primary source for angle, opinion and first-hand experience. " +
        "Keep their specifics — the details, numbers, names and judgements — instead of " +
        "smoothing them into generic statements, and never contradict them. They are " +
        "direction for you, not copy: don't quote them back verbatim or mention that notes " +
        "exist. Where they conflict with the instructions below, the notes win.",
    );
  }

  if (customInstructions.trim()) {
    lines.push("", "Additional instructions:", customInstructions.trim());
  }

  lines.push(
    "",
    otherFields
      ? `Here is the rest of this ${recordName} record for context:\n${otherFields}`
      : `This ${recordName} record has no other fields filled in yet — use the field name and type to produce a sensible value.`,
  );

  return lines.join("\n");
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

      const customInstructions = attr.aiConfig.systemPrompt?.trim()
        ? interpolate(attr.aiConfig.systemPrompt, row)
        : "";

      // Compose extra context block listing other column values so the model
      // can use them even when the user didn't write explicit {{refs}}. `notes`
      // is excluded here — it gets its own, weightier block in the prompt.
      const skip = new Set([fieldKey, "id", "created_at", "updated_at", NOTES_COLUMN]);
      const otherFields = Object.entries(row)
        .filter(([k]) => !skip.has(k))
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `- ${humanizeKey(k)}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n");

      const systemPrompt = buildSystemPrompt({
        fieldKey,
        attr,
        contentType: ct,
        customInstructions,
        notes: typeof row[NOTES_COLUMN] === "string" ? (row[NOTES_COLUMN] as string) : "",
        otherFields,
      });

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
