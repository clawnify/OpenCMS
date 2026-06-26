import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Stable categorical color for data values (categories, tags, authors) — the
 * same value always maps to the same muted bg/text pair. The one place chroma
 * is welcome, because it's data, not chrome. (DESIGN-APPS.md.)
 */
const PILL_COLORS = [
  "#DC2626", "#059669", "#2563EB", "#D97706", "#7C3AED",
  "#0D9488", "#DB2777", "#EA580C", "#9333EA", "#16A34A",
]

/**
 * Returns `{ text, bg }` for a value. `bg` is a 12%-opacity mix of the text
 * color so a single recipe reads correctly on both the white and dark canvas
 * (the spec's dark-mode rule applied uniformly).
 */
export function pillColor(value: string): { text: string; bg: string } {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  const text = PILL_COLORS[Math.abs(hash) % PILL_COLORS.length]
  return { text, bg: `color-mix(in srgb, ${text} 12%, transparent)` }
}
