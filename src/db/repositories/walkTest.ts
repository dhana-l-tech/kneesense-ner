import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import { queueForSync } from '../outbox';
import type { ExerciseCapture, WalkTestMetrics } from '../../types/models';

export interface SaveWalkTestInput {
  sessionId: string;
  startTime: string;
  endTime: string;
  distanceM: number;
  timeS: number;
  steps: number;
  pauseCount: number;
  assistanceNeeded: boolean;
  gaitIrregularity: number; // 0-3
}

/** Walk test has no knee-angle stream, so it writes a bare exercise_captures row (for session grouping / sync) plus its own walk_test_metrics row, instead of going through the motion-analysis pipeline used by saveExerciseCapture. */
export async function saveWalkTest(input: SaveWalkTestInput): Promise<{ capture: ExerciseCapture; metrics: WalkTestMetrics }> {
  const db = getDb();

  const capture: ExerciseCapture = {
    id: uuidv4(),
    session_id: input.sessionId,
    exercise_type: 'walk_test',
    start_time: input.startTime,
    end_time: input.endTime,
    data_source: 'manual',
    created_at: new Date().toISOString(),
    synced: 0,
  };

  await db.run(
    `INSERT INTO exercise_captures (id, session_id, exercise_type, start_time, end_time, data_source, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      capture.id,
      capture.session_id,
      capture.exercise_type,
      capture.start_time,
      capture.end_time,
      capture.data_source,
      capture.created_at,
    ],
  );
  await queueForSync('exercise_captures', capture.id, 'insert', capture as unknown as Record<string, unknown>);

  const speedMps = input.timeS > 0 ? input.distanceM / input.timeS : 0;
  const cadenceSpm = input.timeS > 0 ? (input.steps / input.timeS) * 60 : 0;

  const metrics: WalkTestMetrics = {
    id: uuidv4(),
    exercise_capture_id: capture.id,
    distance_m: input.distanceM,
    time_s: Math.round(input.timeS * 10) / 10,
    steps: input.steps,
    speed_mps: Math.round(speedMps * 100) / 100,
    cadence_spm: Math.round(cadenceSpm * 10) / 10,
    pause_count: input.pauseCount,
    assistance_needed: input.assistanceNeeded ? 1 : 0,
    gait_irregularity: input.gaitIrregularity,
    synced: 0,
  };

  await db.run(
    `INSERT INTO walk_test_metrics (
       id, exercise_capture_id, distance_m, time_s, steps, speed_mps, cadence_spm,
       pause_count, assistance_needed, gait_irregularity, synced
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      metrics.id,
      metrics.exercise_capture_id,
      metrics.distance_m,
      metrics.time_s,
      metrics.steps,
      metrics.speed_mps,
      metrics.cadence_spm,
      metrics.pause_count,
      metrics.assistance_needed,
      metrics.gait_irregularity,
    ],
  );
  await queueForSync('walk_test_metrics', metrics.id, 'insert', metrics as unknown as Record<string, unknown>);

  return { capture, metrics };
}

export async function getWalkTestForSession(sessionId: string): Promise<WalkTestMetrics | null> {
  const db = getDb();
  const res = await db.query(
    `SELECT wtm.* FROM walk_test_metrics wtm
     JOIN exercise_captures ec ON ec.id = wtm.exercise_capture_id
     WHERE ec.session_id = ? ORDER BY ec.created_at DESC LIMIT 1`,
    [sessionId],
  );
  return (res.values?.[0] as unknown as WalkTestMetrics) ?? null;
}
