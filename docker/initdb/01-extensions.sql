-- Bootstrap extensions needed by FeynMap.
-- Runs once on first container start (when the data volume is empty).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
