-- ============================================================
-- MimiQ — Chains table
-- Stores user-saved vocal processing chains from the Sandbox.
-- ============================================================

CREATE TABLE IF NOT EXISTS chains (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT NOT NULL,
  era         TEXT NOT NULL,
  daw         TEXT NOT NULL DEFAULT 'Logic Pro',
  xy_x        REAL NOT NULL DEFAULT 0.5,
  xy_y        REAL NOT NULL DEFAULT 0.5,
  chain       JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary     TEXT NOT NULL DEFAULT '',
  measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast user-scoped queries, most recent first.
CREATE INDEX IF NOT EXISTS idx_chains_user_created
  ON chains (user_id, created_at DESC);
