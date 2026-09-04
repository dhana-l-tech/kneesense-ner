-- =========================================================
-- KneeSense NER — local SQLite schema (Capacitor SQLite)
-- All IDs are client-generated UUIDs so rows sync to Supabase
-- without remapping. Every syncable table has synced/updated_at
-- for outbox-style sync (see sync_outbox).
-- =========================================================

CREATE TABLE IF NOT EXISTS patients (
  id              TEXT PRIMARY KEY,
  patient_code    TEXT UNIQUE NOT NULL,
  age_group       TEXT NOT NULL,
  sex             TEXT,
  occupation      TEXT,
  location        TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  synced          INTEGER NOT NULL DEFAULT 0,
  synced_at       TEXT
);

CREATE TABLE IF NOT EXISTS screening_sessions (
  id                  TEXT PRIMARY KEY,
  patient_id          TEXT NOT NULL REFERENCES patients(id),
  session_date        TEXT NOT NULL,
  affected_knee       TEXT NOT NULL,
  previous_injury     INTEGER NOT NULL DEFAULT 0,
  device_id           TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  synced              INTEGER NOT NULL DEFAULT 0,
  synced_at           TEXT
);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id                            TEXT PRIMARY KEY,
  session_id                    TEXT NOT NULL REFERENCES screening_sessions(id),
  pain_rest                     INTEGER,
  pain_walking                  INTEGER,
  pain_bending                  INTEGER,
  pain_stairs                   INTEGER,
  pain_score_avg                REAL,
  morning_stiffness             INTEGER,
  swelling                      INTEGER,
  walking_difficulty            INTEGER,
  stair_climbing_difficulty     INTEGER,
  stand_from_chair_difficulty   INTEGER,
  previous_injury_detail        TEXT,
  language_used                 TEXT,
  created_at                    TEXT NOT NULL,
  synced                        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercise_captures (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES screening_sessions(id),
  exercise_type   TEXT NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT,
  raw_data_path   TEXT,
  min_angle_deg   REAL,
  max_angle_deg   REAL,
  rom_deg         REAL,
  smoothness      REAL,
  rep_count       INTEGER,
  data_source     TEXT NOT NULL DEFAULT 'ble', -- 'ble' (real sensor), 'simulated' (dev fallback, see sensorSource.ts — riskScores.ts refuses to score a session on simulated knee-extension data), or 'manual' (walk_test rows, which are tap-counted, not sensor-streamed)
  created_at      TEXT NOT NULL,
  synced          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS walk_test_metrics (
  id                   TEXT PRIMARY KEY,
  exercise_capture_id  TEXT NOT NULL REFERENCES exercise_captures(id),
  distance_m           REAL,
  time_s               REAL,
  steps                INTEGER,
  speed_mps            REAL,
  cadence_spm          REAL,
  pause_count          INTEGER,
  assistance_needed    INTEGER,
  gait_irregularity    REAL,
  synced               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS camera_features (
  id                  TEXT PRIMARY KEY,
  exercise_capture_id TEXT NOT NULL REFERENCES exercise_captures(id),
  camera_min_angle    REAL,
  camera_max_angle    REAL,
  camera_rom          REAL,
  confidence_avg      REAL,
  imu_camera_diff     REAL,
  agreement_status    TEXT,
  synced              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS risk_scores (
  id                      TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES screening_sessions(id),
  symptom_score           REAL,
  rom_score               REAL,
  movement_quality_score  REAL,
  mobility_score          REAL,
  agreement_score         REAL,
  weighted_total          REAL,
  risk_category           TEXT,
  model_version           TEXT,
  computed_at             TEXT NOT NULL,
  synced                  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES screening_sessions(id),
  generated_at    TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  language        TEXT,
  synced          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  operation   TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);

-- Device-local app lock (see src/components/PinGate.tsx). Deliberately NOT
-- queued through sync_outbox — a PIN hash is device access material, not
-- patient data, and has no business leaving the device.
CREATE TABLE IF NOT EXISTS app_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1), -- singleton row
  pin_hash            TEXT,
  pin_salt            TEXT,
  health_worker_name  TEXT,
  updated_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_patient ON screening_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_captures_session ON exercise_captures(session_id);
CREATE INDEX IF NOT EXISTS idx_outbox_pending   ON sync_outbox(table_name, record_id);
