/**
 * Thin OpenRouter chat-completions client.
 *
 * Text models use the plain content stream; image-capable models
 * (e.g. `google/gemini-2.5-flash-image-preview`) return generated
 * images as base64 data URLs in `choices[0].message.images[]`.
 */

import { putUpload } from "./uploads";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TEXT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image-preview";

export interface AICallOptions {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  /** Optional secondary user message; defaults to a brief filler since prompts live in the system slot. */
  userMessage?: string;
}

interface ChatResponse {
  choices: Array<{
    message: {
      content: string | null;
      images?: Array<{ image_url?: { url: string } }>;
    };
  }>;
  error?: { message: string };
}

async function call(model: string, body: Record<string, unknown>, apiKey: string): Promise<ChatResponse> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, ...body }),
      });
      const text = await res.text();
      if (!text.trim().startsWith("{")) {
        throw new Error(`OpenRouter returned non-JSON (status ${res.status})`);
      }
      const json = JSON.parse(text) as ChatResponse;
      if (!res.ok) throw new Error(json.error?.message || `OpenRouter ${res.status}`);
      return json;
    } catch (e) {
      lastErr = e as Error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr!;
}

export async function generateText(opts: AICallOptions): Promise<string> {
  const json = await call(
    opts.model || DEFAULT_TEXT_MODEL,
    {
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userMessage || "Generate the value now." },
      ],
    },
    opts.apiKey,
  );
  return (json.choices[0]?.message?.content || "").trim();
}

export async function generateHtml(opts: AICallOptions): Promise<string> {
  // Constrain to raw HTML — no markdown fences, no commentary.
  const sys = `${opts.systemPrompt}\n\nReturn ONLY the raw HTML for the result. No prose, no markdown fences.`;
  const raw = await generateText({ ...opts, systemPrompt: sys });
  // Strip accidental ```html ... ``` wrappers if the model adds them anyway.
  return raw.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

/**
 * Generate an image and upload it to R2. Returns the stable `/api/uploads/...` URL.
 */
export async function generateImage(opts: AICallOptions): Promise<string> {
  const json = await call(
    opts.model || DEFAULT_IMAGE_MODEL,
    {
      messages: [
        { role: "user", content: opts.systemPrompt },
      ],
      modalities: ["image", "text"],
    },
    opts.apiKey,
  );

  const imageUrl = json.choices[0]?.message?.images?.[0]?.image_url?.url;
  if (!imageUrl) {
    throw new Error("Model did not return an image");
  }

  // Expect a data URL: data:image/png;base64,...
  const match = imageUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    // If the model returns a remote URL, fetch and re-upload so it stays available.
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`Failed to fetch generated image: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const contentType = resp.headers.get("content-type") || "image/png";
    const ext = contentType.split("/")[1] || "png";
    return putUpload(`${crypto.randomUUID()}.${ext}`, buf, contentType);
  }
  const contentType = match[1];
  const ext = contentType.split("/")[1] || "png";
  const bytes = base64ToBytes(match[2]);
  return putUpload(`${crypto.randomUUID()}.${ext}`, bytes, contentType);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Replace `{{key}}` references in a template with values from the context map.
 * Unknown keys are left as-is so the user can see what wasn't substituted.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, key) => {
    if (!(key in context)) return m;
    const v = context[key];
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  });
}

/** Pull out the `{{key}}` references from a template, in order of first appearance. */
export function extractRefs(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}
