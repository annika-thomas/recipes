-- Kitchen — the shared recipe box.
--
-- Everything lives in one D1 database that both phones talk to, so a recipe
-- either of you adds shows up for the other. Records are never hard-deleted:
-- `deleted_at` tombstones them, which keeps a cook log from losing the recipe
-- it points at.

CREATE TABLE IF NOT EXISTS recipes (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'mains',   -- see CATEGORIES in worker/lib/recipeSchema.js
  cuisine       TEXT,
  servings      REAL,
  servings_unit TEXT,                            -- "servings", "cookies", "loaf"
  prep_min      INTEGER,
  cook_min      INTEGER,
  ingredients   TEXT NOT NULL DEFAULT '[]',      -- JSON [{qty, unit, item, note, group}]
  steps         TEXT NOT NULL DEFAULT '[]',      -- JSON [{text, group}]
  tags          TEXT NOT NULL DEFAULT '[]',      -- JSON ["vegetarian", "quick"]
  source_type   TEXT NOT NULL DEFAULT 'manual',  -- manual | photo | link | social
  source_url    TEXT,
  source_name   TEXT,                            -- "NYT Cooking", "@kenjilopezalt"
  source_note   TEXT,                            -- anything the importer couldn't structure
  image_key     TEXT,                            -- object key in R2
  added_by      TEXT NOT NULL DEFAULT 'someone',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes (category, deleted_at);
CREATE INDEX IF NOT EXISTS idx_recipes_updated  ON recipes (updated_at);

-- Every time one of you actually cooks something.
CREATE TABLE IF NOT EXISTS cooks (
  id         TEXT PRIMARY KEY,
  recipe_id  TEXT NOT NULL REFERENCES recipes (id),
  cooked_on  TEXT NOT NULL,                      -- YYYY-MM-DD, local date, not UTC
  cooked_by  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cooks_date   ON cooks (cooked_on);
CREATE INDEX IF NOT EXISTS idx_cooks_recipe ON cooks (recipe_id, cooked_on);

-- One rating per person per recipe, so "she loved it, he didn't" survives.
CREATE TABLE IF NOT EXISTS ratings (
  recipe_id  TEXT NOT NULL REFERENCES recipes (id),
  person     TEXT NOT NULL,
  stars      INTEGER NOT NULL,                   -- 1..5
  updated_at TEXT NOT NULL,
  PRIMARY KEY (recipe_id, person)
);

-- Free notes: "double the garlic", "needed 10 more minutes".
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  recipe_id  TEXT NOT NULL REFERENCES recipes (id),
  person     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_recipe ON notes (recipe_id, created_at);

-- What's actually in the house right now.
CREATE TABLE IF NOT EXISTS pantry (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  norm       TEXT NOT NULL,                      -- normalised for matching ingredients
  location   TEXT NOT NULL DEFAULT 'pantry',     -- fridge | freezer | pantry | spices
  qty        TEXT,
  staple     INTEGER NOT NULL DEFAULT 0,         -- always assumed in stock (salt, oil)
  added_by   TEXT NOT NULL DEFAULT 'someone',
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pantry_norm ON pantry (norm);
