import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import { queueForSync } from '../outbox';
import type { ExerciseCapture, ExerciseType } from '../../types/models';
import { computeROM, computeSmoothness, countReps, withKneeAngle, type AngleSample } from '../../lib/motionAnalysis';

export interface SaveCaptureInput {
  sessionId: string;
  exerciseType: ExerciseType;
  startTime: string;
  endTime: string;
  samples: AngleSample[];
  /** Which SensorSource produced `samples` — 'simulated' means no ESP32 was connected (see sensorSource.ts). riskScores.ts refuses to compute a real risk score from a simulated knee-extension capture. */
  dataSource: 'ble' | 'simulated';
}

/** Runs the motion analysis and persists both the summary row and the raw stream. */
export async function saveExerciseCapture(input: SaveCaptureInput): Promise<ExerciseCapture> {
  const db = getDb();
  const withAngle = withKneeAngle(input.samples);
  const { minAngle, maxAngle, rom } = computeROM(withAngle);
  const smoothness = computeSmoothness(withAngle);
  const { repCount } = countReps(withAngle);

  const capture: ExerciseCapture = {
    id: uuidv4(),
    session_id: input.sessionId,
    exercise_type: input.exerciseType,
    start_time: input.startTime,
    end_time: input.endTime,
    raw_data_path: undefined, // raw stream stored inline below for now; see note in schema.sql
    min_angle_deg: Math.round(minAngle * 10) / 10,
    max_angle_deg: Math.round(maxAngle * 10) / 10,
    rom_deg: Math.round(rom * 10) / 10,
    smoothness: Math.round(smoothness * 1000) / 1000,
    rep_count: repCount,
    data_source: input.dataSource,
    created_at: new Date().toISOString(),
    synced: 0,
  };

  await db.run(
    `INSERT INTO exercise_captures (
       id, session_id, exercise_type, start_time, end_time, raw_data_path,
       min_angle_deg, max_angle_deg, rom_deg, smoothness, rep_count, data_source, created_at, synced
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      capture.id,
      capture.session_id,
      capture.exercise_type,
      capture.start_time,
      capture.end_time ?? null,
      capture.raw_data_path ?? null,
      capture.min_angle_deg ?? null,
      capture.max_angle_deg ?? null,
      capture.rom_deg ?? null,
      capture.smoothness ?? null,
      capture.rep_count ?? null,
      capture.data_source,
      capture.created_at,
    ],
  );

  await queueForSync('exercise_captures', capture.id, 'insert', capture as unknown as Record<string, unknown>);
  return capture;
}

export async function listCapturesForSession(sessionId: string): Promise<ExerciseCapture[]> {
  const db = getDb();
  const res = await db.query('SELECT * FROM exercise_captures WHERE session_id = ? ORDER BY created_at ASC', [
    sessionId,
  ]);
  return (res.values ?? []) as unknown as ExerciseCapture[];
}
