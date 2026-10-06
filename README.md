<img src="readme-banner.png" alt="OpenCMS preview" />

# OpenCMS

[![Deploy with Clawnify](https://app.clawnify.com/deploy-button.svg)](https://app.clawnify.com/deploy?repo=clawnify/OpenCMS)

A headless content-management studio built for **Clawnify**. **React + Tailwind CSS + Hono + D1 + R2**, deployed to Cloudflare Workers via [Clawnify](https://clawnify.com).

Auth, plugins, and integrations are handled by Clawnify — this template focuses on a clean editing UI and a typed REST API that Clawnify agents can consume from day one.

<img width="1728" height="425" alt="Image" src="https://github.com/user-attachments/assets/1289ef81-3d97-47b6-9988-9a5b6af6d3d2" />

## Features

- **Spreadsheet-style table** — every field is a column; cells are inline-editable (text, image, status, featured)
- **Slide-in editor sheet** — opens as an overlay (table stays visible underneath) for rich-text editing
- **Rich-text content** — Tiptap editor with image upload, links, lists, blockquote, code blocks, and headings
- **Notes on every entry** — a freeform brief for whoever writes the content: the angle, what you know first-hand, what to avoid. Weighted above everything else in AI generation, so what comes out carries a point of view instead of the usual generic summary. Present in every library with no setup, kept out of the table, and served from its own non-public endpoint so it never rides along on the public read API
- **Live status pill** — green / gray pill with embedded chevron, change inline or from the editor
- **Auto-save with debounce** — 350ms debounce, Saving / Saved / Error indicator
- **Slug auto-generation** — slugified from title, kept unique server-side (a unique index backs it, built as soon as the column has no duplicates; the editor flags any that do), with live URL preview
- **Image library on R2** — upload from cell or rich-text editor, served from `/api/uploads/:filename`
- **Narrowable list API**: `?fields=title,slug` returns just those columns, and `?limit`/`?page` page through a library with the total in an `X-Total-Count` header. An entry carries its full richtext body, so an index page that asks for three columns transfers three columns
- **OpenAPI spec at `/api/openapi.json`** — Clawnify agents introspect the schema and call endpoints directly
- **URL routing** — `pushState`-based, bookmarkable post URLs (`/posts/:id`)

## Quickstart

```bash
git clone https://github.com/clawnify/OpenCMS.git
cd open-cms
pnpm install
```

Start the dev server:

```bash
pnpm dev
```

Open `http://localhost:5173`. The D1 schema is applied automatically on the first request.

No environment variables required — Clawnify provides auth and any third-party credentials at deploy time.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Vite |
| **UI** | shadcn/ui (radix-nova preset), lucide-react |
| **Table** | TanStack Table v8 |
| **Editor** | Tiptap v3 (StarterKit + Image + Link + Placeholder) |
| **Backend** | Hono on Cloudflare Workers, `@hono/zod-openapi` |
| **Database** | D1 (SQLite at the edge) |
| **Storage** | R2 (file uploads) |

### Prerequisites

- Node.js 22+
- pnpm

## Architecture

```
src/
  server/
    index.ts              — Worker entry, Hono app + D1/R2 middleware + auto-schema
    routes-entries.ts     — REST endpoints for entries (OpenAPI-documented)
    routes-uploads.ts     — Multipart upload + serving from R2
    db.ts                 — D1 query/get/run helpers
    uploads.ts            — R2 put/get adapter
    schema.sql            — Posts table, indexes, status check
  client/
    main.tsx              — React mount point
    app.tsx               — Root: sidebar + table + sheet overlay editor
    hooks/
      use-router.ts       — pushState routing for /posts/:id
    lib/
      api.ts              — Typed fetch client
      types.ts            — Post, PostStatus, PostPatch
      utils.ts            — cn() shadcn helper
    components/
      sidebar.tsx         — Collections / Fields tabs (Plugins owned by Clawnify)
      posts-table.tsx     — TanStack Table with inline cell editors
      post-editor.tsx     — Sheet content: all fields + rich-text editor
      rich-editor.tsx     — Tiptap toolbar + EditorContent + image upload
      status-pill.tsx     — Green / gray pill, optional chevron
      ui/                 — shadcn primitives (table, button, sheet, select, …)
```

### API Endpoints

Routes are generic over the library. `:plural` is a content type's plural name
(`posts`, `articles`), and `:id` accepts either the numeric id or the entry's slug.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/entries/:plural`      | List entries, newest first (live only) |
| POST   | `/api/entries/:plural`      | Create an entry |
| GET    | `/api/entries/:plural/:id`  | Get a single entry |
| PATCH  | `/api/entries/:plural/:id`  | Update any subset of fields |
| DELETE | `/api/entries/:plural/:id`  | Delete an entry |
| GET    | `/api/uploads/:filename`    | Serve an uploaded file |
| POST   | `/api/uploads`              | Multipart image upload, returns `{ url, filename }` |
| GET    | `/api/openapi.json`         | OpenAPI 3.0 spec for the whole API |

Only `GET` under `/api/entries` is public; writes, drafts (`/api/admin/entries/*`) and
notes (`/api/notes/*`) are gated.

#### Narrowing a list

A listed entry carries every field it has, richtext bodies included, so a library of long
posts is a large response. Three optional query params on both list routes cut it down:

| Param | Description |
|-------|-------------|
| `fields`  | Comma-separated fields to return, e.g. `title,slug,status`. `id` always rides along |
| `limit`   | Page size, 1–500 |
| `page`    | 1-based page number. Implies `limit=25` when `limit` is absent |

```bash
curl "$BASE/api/entries/posts?fields=title,slug,post_date&limit=25"
```

`fields` works on the single-entry routes too. When `limit` or `page` is present the response
carries an `X-Total-Count` header with the unpaged total.

Sending none of them returns **every entry with every field**, unchanged. That is what a sync
tool wiring up a whole collection wants, and what an index page does not. A library is one
unbounded read in that mode, so past a few thousand entries a list call should always carry
`fields` or `page`.

Every entry has a `notes` string — the author's brief. Write it through the entry `PATCH`, read
it from `GET /api/notes/:pluralName/:id`. It deliberately never appears in `/api/entries/**`
responses: those are declared public in `clawnify.json` (which is what makes them readable
cross-origin by a site or Zapier), while `/api/notes/*` is not, so the platform perimeter gates
it. Agents and the editor reach it; an anonymous visitor gets a 403.

## Deploy

```bash
npx clawnify deploy
```

## License

MIT
