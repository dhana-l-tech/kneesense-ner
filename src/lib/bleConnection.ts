import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import {
  ANGLE_CHAR_UUID,
  CONTROL_CHAR_UUID,
  CONTROL_CMD,
  SERVICE_UUID,
  STATUS_CHAR_UUID,
  decodeAnglePayload,
  decodeStatusByte,
} from './bleProtocol';
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

/**
 * Fan-out for BLE disconnect events. There's exactly one native disconnect
 * callback per connection (registered in connect() below), but more than
 * one screen needs to react to it — SensorPairingPage resets its own
 * status, and whichever capture page is mid-capture needs to stop and show
 * an error rather than silently freezing. Returns an unsubscribe function.
 */
const disconnectListeners = new Set<() => void>();

export function onDisconnect(listener: () => void): () => void {
  disconnectListeners.add(listener);
  return () => disconnectListeners.delete(listener);
}

/**
 * Connects and returns whether the firmware's last boot was a brownout
 * reset (see bleProtocol.ts's decodeStatusByte) — the closest available
 * low-power signal given this hardware runs off USB from a power bank with
 * no battery-voltage rail to sense live. Reading the status characteristic
 * is best-effort: an older/mismatched firmware without it shouldn't block
 * a successful connection, so a read failure just reports "no warning"
 * rather than throwing.
 */
export async function connect(): Promise<{ possibleLowPowerReset: boolean }> {
  await ensureInitialized();
  const device = await BleClient.requestDevice({ services: [SERVICE_UUID] });
  await BleClient.connect(device.deviceId, () => {
    deviceId = null;
    disconnectListeners.forEach((listener) => listener());
  });
  deviceId = device.deviceId;

  let possibleLowPowerReset = false;
  try {
    const status = await BleClient.read(device.deviceId, SERVICE_UUID, STATUS_CHAR_UUID);
    possibleLowPowerReset = decodeStatusByte(status).lastResetWasBrownout;
  } catch (err) {
    console.warn('[ble] could not read status characteristic', err);
  }
  return { possibleLowPowerReset };
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
    start(onSample: (sample: AngleSample) => void, onError?: (error: unknown) => void) {
      if (!deviceId) {
        onError?.(new Error('Not connected to a sensor'));
        return;
      }
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
        .catch((err) => {
          console.error('[ble] failed to start streaming', err);
          onError?.(err);
        });
    },
    stop() {
      if (!deviceId) return;
      const id = deviceId;
      BleClient.write(id, SERVICE_UUID, CONTROL_CHAR_UUID, numbersToDataView([CONTROL_CMD.STOP_STREAMING])).catch(() => {});
      BleClient.stopNotifications(id, SERVICE_UUID, ANGLE_CHAR_UUID).catch(() => {});
    },
  };
}
