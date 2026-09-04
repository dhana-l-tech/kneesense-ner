import type { AngleSample } from './motionAnalysis';

/**
 * Common shape for anything that streams thigh/shin angle samples into an
 * exercise capture — today that's only the real ESP32 link
 * (bleConnection.ts's createBleSensorSource()). There is deliberately no
 * simulated/fake implementation of this interface: a screening tool must
 * never silently substitute fabricated data for a missing sensor. Capture
 * pages instead show a blocking error (see ErrorModal.tsx) when no sensor
 * is connected.
 */
export interface SensorSource {
  start(onSample: (sample: AngleSample) => void, onError?: (error: unknown) => void): void;
  stop(): void;
}
