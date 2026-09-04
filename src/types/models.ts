// Mirrors src/db/schema.sql 1:1 so local rows and Supabase rows share shapes.

export type AgeGroup = '18-30' | '31-45' | '46-60' | '60+';
export type Sex = 'M' | 'F' | 'other' | 'prefer_not_to_say';
export type AffectedKnee = 'left' | 'right' | 'both';
export type SessionStatus = 'draft' | 'completed';
export type ExerciseType = 'knee_extension' | 'sit_to_stand' | 'walk_test';
export type AgreementStatus = 'agree' | 'check_filtering' | 'mismatch';
export type RiskCategory = 'low' | 'moderate' | 'high';
export type Language = 'en' | 'as' | 'bn' | 'hi' | 'ta';

export interface Patient {
  id: string;
  patient_code: string;
  age_group: AgeGroup;
  sex?: Sex;
  occupation?: string;
  location?: string;
  created_at: string;
  created_by?: string;
  updated_at: string;
  synced: 0 | 1;
  synced_at?: string;
}

export interface ScreeningSession {
  id: string;
  patient_id: string;
  session_date: string;
  affected_knee: AffectedKnee;
  previous_injury: 0 | 1;
  device_id?: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  synced: 0 | 1;
  synced_at?: string;
}

export interface QuestionnaireResponse {
  id: string;
  session_id: string;
  pain_rest?: number;
  pain_walking?: number;
  pain_bending?: number;
  pain_stairs?: number;
  pain_score_avg?: number;
  morning_stiffness?: number;
  swelling?: number;
  walking_difficulty?: number;
  stair_climbing_difficulty?: number;
  stand_from_chair_difficulty?: number;
  previous_injury_detail?: string;
  language_used?: Language;
  created_at: string;
  synced: 0 | 1;
}

export interface ExerciseCapture {
  id: string;
  session_id: string;
  exercise_type: ExerciseType;
  start_time: string;
  end_time?: string;
  raw_data_path?: string;
  min_angle_deg?: number;
  max_angle_deg?: number;
  rom_deg?: number;
  smoothness?: number;
  rep_count?: number;
  /** 'manual' = walk_test rows, which have no angle stream at all (tap-counted, not sensor-driven). */
  data_source: 'ble' | 'simulated' | 'manual';
  created_at: string;
  synced: 0 | 1;
}

export interface WalkTestMetrics {
  id: string;
  exercise_capture_id: string;
  distance_m?: number;
  time_s?: number;
  steps?: number;
  speed_mps?: number;
  cadence_spm?: number;
  pause_count?: number;
  assistance_needed?: 0 | 1;
  gait_irregularity?: number;
  synced: 0 | 1;
}

export interface CameraFeatures {
  id: string;
  exercise_capture_id: string;
  camera_min_angle?: number;
  camera_max_angle?: number;
  camera_rom?: number;
  confidence_avg?: number;
  imu_camera_diff?: number;
  agreement_status?: AgreementStatus;
  synced: 0 | 1;
}

export interface RiskScore {
  id: string;
  session_id: string;
  symptom_score?: number;
  rom_score?: number;
  movement_quality_score?: number;
  mobility_score?: number;
  agreement_score?: number;
  weighted_total?: number;
  risk_category?: RiskCategory;
  model_version?: string;
  computed_at: string;
  synced: 0 | 1;
}

export interface Report {
  id: string;
  session_id: string;
  generated_at: string;
  file_path: string;
  language?: Language;
  synced: 0 | 1;
}

export interface SyncOutboxRow {
  id: string;
  table_name: string;
  record_id: string;
  operation: 'insert' | 'update';
  payload: string;
  created_at: string;
  attempts: number;
  last_error?: string;
}
