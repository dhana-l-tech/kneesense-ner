import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import { ANGLE_CHAR_UUID, CONTROL_CHAR_UUID, CONTROL_CMD, SERVICE_UUID, decodeAnglePayload } from './bleProtocol';
import type { SensorSource } from './sensorSource';
import type { AngleSample } from './motionAnalysis';

/**
 * A rural health worker pairs the ESP32 once after attaching the sensors
 * (see SensorPairingPage), then runs knee-extension, sit-to-stand, etc.
 * without re-pairing between exercises — so this is a module-level
 * singleton connection, not something each capture page owns.
 */
let deviceId: string | null = null;
let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await BleClient.initialize();
    initialized = true;
  }
}

export function isConnected(): boolean {
  return deviceId !== null;
}

export async function connect(onDisconnect?: () => void): Promise<void> {
  await ensureInitialized();
  const device = await BleClient.requestDevice({ services: [SERVICE_UUID] });
  await BleClient.connect(device.deviceId, () => {
    deviceId = null;
    onDisconnect?.();
  });
  deviceId = device.deviceId;
}

export async function disconnect(): Promise<void> {
  if (!deviceId) return;
  await BleClient.disconnect(deviceId);
  deviceId = null;
}

/** Sends the calibrate command; firmware zeroes the sensor's angle reference while the leg is held straight and still. */
export async function calibrate(): Promise<void> {
  if (!deviceId) throw new Error('Not connected to a sensor');
  await BleClient.write(deviceId, SERVICE_UUID, CONTROL_CHAR_UUID, numbersToDataView([CONTROL_CMD.CALIBRATE]));
}

/**
 * A SensorSource backed by the already-connected ESP32. start()/stop() just
 * toggle streaming on the existing connection — they don't reconnect, so
 * this can be called once per exercise across a whole session.
 */
export function createBleSensorSource(): SensorSource {
  return {
    start(onSample: (sample: AngleSample) => void) {
      if (!deviceId) throw new Error('Not connected to a sensor');
      const id = deviceId;
      BleClient.startNotifications(id, SERVICE_UUID, ANGLE_CHAR_UUID, (value) => {
        const { t, angle } = decodeAnglePayload(value);
        // Single-sensor hardware (shin-mounted): the thigh is assumed to
        // stay still during seated knee extension (it rests on the chair),
        // so its angle is fixed at the calibrated 0deg reference and knee
        // angle reduces to |shinAngle - 0| = shinAngle in motionAnalysis.ts.
        // This assumption does NOT hold for sit-to-stand (the thigh does
        // most of that motion) — see firmware/README.md.
        onSample({ t, thighAngle: 0, shinAngle: angle });
      })
        .then(() => BleClient.write(id, SERVICE_UUID, CONTROL_CHAR_UUID, numbersToDataView([CONTROL_CMD.START_STREAMING])))
        .catch((err) => console.error('[ble] failed to start streaming', err));
    },
    stop() {
      if (!deviceId) return;
      const id = deviceId;
      BleClient.write(id, SERVICE_UUID, CONTROL_CHAR_UUID, numbersToDataView([CONTROL_CMD.STOP_STREAMING])).catch(() => {});
      BleClient.stopNotifications(id, SERVICE_UUID, ANGLE_CHAR_UUID).catch(() => {});
    },
  };
}
