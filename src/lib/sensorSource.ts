import type { AngleSample } from './motionAnalysis';

export interface SensorSource {
  start(onSample: (sample: AngleSample) => void, onError?: (error: unknown) => void): void;
  stop(): void;
}

/**
 * Stand-in for the real ESP32 link when no sensor is connected — restored
 * as a deliberate fallback (project deadline, ESP32 hardware not currently
 * working) so the capture screens, risk scoring, and report generation can
 * still be exercised end-to-end. Produces a seated-knee-extension-shaped
 * signal: thigh roughly still, shin swinging between flexed and extended,
 * with noise and small rep-to-rep drift so smoothness/ROM/rep-count all
 * have something realistic to compute over. Every capture that uses this
 * is recorded with data_source: 'simulated' (see exerciseCaptures.ts).
 */
export class SimulatedKneeExtensionSource implements SensorSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  start(onSample: (sample: AngleSample) => void): void {
    this.startedAt = performance.now();
    const sampleRateMs = 20; // 50 Hz, matches a typical MPU6050 read loop
    const repPeriodMs = 2200;

    this.intervalId = setInterval(() => {
      const t = performance.now() - this.startedAt;
      const phase = (t % repPeriodMs) / repPeriodMs; // 0..1 per rep
      // Extension-hold-flex-hold shape, not a pure sine, so peaks/valleys
      // are distinguishable — smoothed triangle wave.
      const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const shinBase = 80 - tri * 65; // 80deg (flexed) down to 15deg (extended)
      const noise = () => (Math.random() - 0.5) * 2;

      onSample({
        t,
        thighAngle: 2 + noise() * 0.5,
        shinAngle: shinBase + noise(),
      });
    }, sampleRateMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

/**
 * Same dev/fallback role as SimulatedKneeExtensionSource, shaped for
 * sit-to-stand instead: the shank stays roughly vertical throughout (feet
 * stay planted), while the thigh does most of the rotation, swinging from
 * ~85deg (seated, thigh horizontal) to ~5deg (standing, thigh vertical) —
 * so most of the ~80deg knee-angle ROM comes from thigh movement, not shin,
 * matching real sit-to-stand biomechanics. Reps are slower than knee
 * extension.
 */
export class SimulatedSitToStandSource implements SensorSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  start(onSample: (sample: AngleSample) => void): void {
    this.startedAt = performance.now();
    const sampleRateMs = 20;
    const repPeriodMs = 4000;

    this.intervalId = setInterval(() => {
      const t = performance.now() - this.startedAt;
      const phase = (t % repPeriodMs) / repPeriodMs;
      const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const noise = () => (Math.random() - 0.5) * 2;

      onSample({
        t,
        thighAngle: 85 - tri * 80 + noise(), // seated ~85deg down to standing ~5deg
        shinAngle: 8 + noise() * 0.7, // stays roughly vertical/planted throughout
      });
    }, sampleRateMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
