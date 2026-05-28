-- NOTE: If `plan` already exists, SQLite will raise a duplicate-column error.
-- You can safely ignore that error for existing upgraded databases.
ALTER TABLE user_profile ADD COLUMN plan TEXT DEFAULT 'free' NOT NULL;

UPDATE user_profile
SET plan = 'free'
WHERE plan IS NULL OR TRIM(plan) = '';

CREATE TABLE IF NOT EXISTS daily_usage(
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, usage_date, metric)
);

