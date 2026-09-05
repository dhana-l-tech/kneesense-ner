import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../client';
import { queueForSync } from '../outbox';
import { computeRiskScore, type RiskScoreBreakdown } from '../../lib/riskScoring';
import type { RiskScore } from '../../types/models';
import { getQuestionnaireForSession } from './questionnaire';
import { listCapturesForSession } from './exerciseCaptures';
import { getWalkTestForSession } from './walkTest';
import { getCameraFeaturesForCapture } from './cameraFeatures';

const MIN_TRUSTED_CAMERA_CONFIDENCE = 0.5;

/** Pulls the session's saved questionnaire + exercise captures, scores them, and persists the result. */
export async function computeAndSaveRiskScore(sessionId: string): Promise<RiskScore & { breakdown: RiskScoreBreakdown }> {
  const questionnaire = await getQuestionnaireForSession(sessionId);
  if (!questionnaire) throw new Error('Cannot score a session with no saved questionnaire');

  const captures = await listCapturesForSession(sessionId);
  const kneeExtension = captures.find((c) => c.exercise_type === 'knee_extension') ?? null;
  const walkTest = await getWalkTestForSession(sessionId);
  const cameraFeatures = kneeExtension ? await getCameraFeaturesForCapture(kneeExtension.id) : null;
  // "If camera confidence is low, rely more on the IMU" (spec) — a
  // low-confidence reading doesn't get to count against agreement.
  const trustedCameraDiff =
    cameraFeatures && (cameraFeatures.confidence_avg ?? 0) >= MIN_TRUSTED_CAMERA_CONFIDENCE
      ? (cameraFeatures.imu_camera_diff ?? null)
      : null;

  const breakdown = computeRiskScore({
    painScoreAvg: questionnaire.pain_score_avg ?? 0,
    morningStiffness: questionnaire.morning_stiffness ?? 0,
    swelling: questionnaire.swelling ?? 0,
    romDeg: kneeExtension?.rom_deg ?? null,
    smoothness: kneeExtension?.smoothness ?? null,
    walkingDifficulty: questionnaire.walking_difficulty ?? 0,
    stairClimbingDifficulty: questionnaire.stair_climbing_difficulty ?? 0,
    standFromChairDifficulty: questionnaire.stand_from_chair_difficulty ?? 0,
    walkTest: walkTest
      ? {
          speedMps: walkTest.speed_mps ?? 0,
          pauseCount: walkTest.pause_count ?? 0,
          assistanceNeeded: walkTest.assistance_needed === 1,
          gaitIrregularity: walkTest.gait_irregularity ?? 0,
        }
      : null,
    imuCameraDiffDeg: trustedCameraDiff,
  });

  const db = getDb();
  const row: RiskScore = {
    id: uuidv4(),
    session_id: sessionId,
    symptom_score: breakdown.symptomScore,
    rom_score: breakdown.romScore,
    movement_quality_score: breakdown.movementQualityScore,
    mobility_score: breakdown.mobilityScore,
    agreement_score: breakdown.agreementScore,
    weighted_total: breakdown.weightedTotal,
    risk_category: breakdown.riskCategory,
    model_version: 'rule_based_v1',
    computed_at: new Date().toISOString(),
    synced: 0,
  };

  await db.run(
    `INSERT INTO risk_scores (
       id, session_id, symptom_score, rom_score, movement_quality_score, mobility_score,
       agreement_score, weighted_total, risk_category, model_version, computed_at, synced
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      row.id,
      row.session_id,
      row.symptom_score ?? null,
      row.rom_score ?? null,
      row.movement_quality_score ?? null,
      row.mobility_score ?? null,
      row.agreement_score ?? null,
      row.weighted_total ?? null,
      row.risk_category ?? null,
      row.model_version ?? null,
      row.computed_at,
    ],
  );

  await queueForSync('risk_scores', row.id, 'insert', row as unknown as Record<string, unknown>);
  return { ...row, breakdown };
}

export async function getRiskScoreForSession(sessionId: string): Promise<RiskScore | null> {
  const db = getDb();
  const res = await db.query('SELECT * FROM risk_scores WHERE session_id = ? ORDER BY computed_at DESC LIMIT 1', [
    sessionId,
  ]);
  return (res.values?.[0] as unknown as RiskScore) ?? null;
}
