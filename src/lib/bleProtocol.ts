// Shared contract between the ESP32 firmware (firmware/kneesense_esp32/kneesense_esp32.ino)
// and the app. Keep both sides in sync if you change this.
//
// Single-sensor mode: the hardware now carries one MPU6050 (shin-mounted)
// instead of the earlier thigh+shin pair, so the wire payload carries one
// angle. See bleConnection.ts for how that's turned into the two-angle
// AngleSample the rest of the app (motionAnalysis.ts etc.) still expects.

export const SERVICE_UUID = 'b5b2b8a0-0001-4f0a-9e0a-1a2b3c4d5e6f';
export const ANGLE_CHAR_UUID = 'b5b2b8a0-0002-4f0a-9e0a-1a2b3c4d5e6f';
export const CONTROL_CHAR_UUID = 'b5b2b8a0-0003-4f0a-9e0a-1a2b3c4d5e6f';
export const STATUS_CHAR_UUID = 'b5b2b8a0-0004-4f0a-9e0a-1a2b3c4d5e6f';

export const CONTROL_CMD = {
  CALIBRATE: 0x01,
  START_STREAMING: 0x02,
  STOP_STREAMING: 0x03,
} as const;

/**
 * Angle notify payload is 8 bytes, little-endian (ESP32/Xtensa is
 * little-endian): uint32 millis-since-boot, float32 angle (the shin
 * sensor's angle from its calibrated-straight-leg reference). Kept
 * deliberately small — BLE's default ATT payload is 20 bytes, and we don't
 * want to depend on MTU negotiation succeeding.
 */
export function decodeAnglePayload(value: DataView): { t: number; angle: number } {
  return {
    t: value.getUint32(0, true),
    angle: value.getFloat32(4, true),
  };
}

const STATUS_BIT_LAST_RESET_BROWNOUT = 0x01;

/**
 * Status byte, read once right after connecting (not subscribed to — it
 * only changes across a firmware reboot). The board runs off USB from a
 * power bank with no battery-voltage rail to sense directly, so the
 * ESP32's own brownout detector is the only available low-power signal:
 * bit 0 set means the firmware's *previous* boot was force-reset because
 * the input voltage sagged too low. It's retrospective (found out after
 * the fact, on the next connect), not a live warning during a capture.
 */
export function decodeStatusByte(value: DataView): { lastResetWasBrownout: boolean } {
  const byte = value.getUint8(0);
  return { lastResetWasBrownout: (byte & STATUS_BIT_LAST_RESET_BROWNOUT) !== 0 };
}
