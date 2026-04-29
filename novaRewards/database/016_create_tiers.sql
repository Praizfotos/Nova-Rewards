-- Migration 016: Create tiers and tier history tables
-- Implements reward tier system with multipliers

CREATE TABLE IF NOT EXISTS tiers (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(50) UNIQUE NOT NULL,
  min_points              INTEGER NOT NULL CHECK (min_points >= 0),
  max_points              INTEGER CHECK (max_points IS NULL OR max_points > min_points),
  earning_multiplier      NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (earning_multiplier > 0),
  redemption_multiplier   NUMERIC(4, 2) NOT NULL DEFAULT 1.00 CHECK (redemption_multiplier > 0),
  expiration_days         INTEGER DEFAULT 365 CHECK (expiration_days > 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tier history for audit trail and tier progression tracking
CREATE TABLE IF NOT EXISTS tier_history (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  from_tier_id            INTEGER REFERENCES tiers(id),
  to_tier_id              INTEGER NOT NULL REFERENCES tiers(id),
  reason                  VARCHAR(100),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add tier fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_id INTEGER REFERENCES tiers(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tiers_name ON tiers (name);
CREATE INDEX IF NOT EXISTS idx_tiers_min_points ON tiers (min_points);
CREATE INDEX IF NOT EXISTS idx_tier_history_user_id ON tier_history (user_id);
CREATE INDEX IF NOT EXISTS idx_tier_history_created_at ON tier_history (created_at);
CREATE INDEX IF NOT EXISTS idx_users_tier_id ON users (tier_id);

-- Insert default tiers
INSERT INTO tiers (name, min_points, max_points, earning_multiplier, redemption_multiplier, expiration_days)
VALUES
  ('Bronze', 0, 999, 1.00, 1.00, 365),
  ('Silver', 1000, 4999, 1.10, 1.05, 730),
  ('Gold', 5000, 9999, 1.25, 1.10, 730),
  ('Platinum', 10000, NULL, 1.50, 1.25, 1095)
ON CONFLICT (name) DO NOTHING;
