-- Baseline schema for open-cms.
--
-- Only the schema-as-data registry (`content_types`) lives here. Per-collection
-- tables are provisioned at runtime by schema-sync, because their column set
-- is defined by content-type rows rather than a static DDL.

CREATE TABLE IF NOT EXISTS content_types (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'collectionType',
  collection_name TEXT NOT NULL UNIQUE,
  info TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '{}',
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
