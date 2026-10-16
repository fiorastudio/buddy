-- Generated from src/lib/world/schema-sql.ts (MIGRATION_0002_HOT_QUERY_INDEXES) — do not edit by hand.
-- The migration-drift test enforces this file matches it.
CREATE INDEX IF NOT EXISTS idx_citizens_district_seen ON citizens(district, last_seen_at) WHERE hidden = 0;
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON world_events(type, ts);
CREATE INDEX IF NOT EXISTS idx_rollups_citizen ON daily_rollups(citizen_id);
