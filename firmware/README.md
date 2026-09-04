# KneeSense NER — ESP32 firmware

Streams a shin orientation angle over BLE to the app (single-sensor mode — one MPU6050, shin-mounted; the earlier two-sensor thigh+shin design was dropped). See the wiring diagram and pin notes at the top of [`kneesense_esp32/kneesense_esp32.ino`](kneesense_esp32/kneesense_esp32.ino) — that file is the source of truth for wiring, not this README.

**Not compiled/flashed in this session** — there's no Arduino toolchain available here, so this needs to be verified on your machine before trusting it on real hardware.

## Setup (Arduino IDE)

1. **Board support**: File → Preferences → Additional Boards Manager URLs → add `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`, then Tools → Board → Boards Manager → install **esp32** (Espressif Systems).
2. **Board selection**: Tools → Board → ESP32 Arduino → **ESP32 Dev Module** (or your specific board if different).
3. **Libraries** (Sketch → Include Library → Manage Libraries): install
   - `Adafruit MPU6050`
   - `Adafruit Unified Sensor`
   - `Adafruit BusIO`

   (The ESP32 BLE library — `BLEDevice.h` etc. — ships with the esp32 board package, nothing extra to install there.)
4. Wire everything per the comment block at the top of the `.ino` file.
5. Upload, then open the Serial Monitor at **115200 baud** — it'll print an error if the sensor isn't found at its expected I2C address (a wiring/AD0 check).
6. **Calibrate with the leg fully straight.** In single-sensor mode the app computes knee angle directly from this one sensor's angle relative to whatever pose it was calibrated in — see "Single-sensor mode" below.

## Expected LED behavior

- **Blue** — booting
- **Solid red** (stays on) — a sensor didn't respond at startup; check wiring/AD0 before continuing
- **Red, briefly** — calibrating (keep the leg still)
- **Green** — calibrated and idle
- **Blue, solid** — a phone/app is connected over BLE

## Testing without the app

The Serial Monitor only prints a sensor-not-found error right now. To sanity-check the IMU readings independently before involving BLE at all, temporarily add a `Serial.print`/`println` call for `shinAngle` in `loop()` — that's the fastest way to confirm the complementary filter looks reasonable (near 0 right after calibrating with the leg straight, increasing smoothly as the knee bends) before debugging anything at the BLE layer.

## Protocol

Matches [`src/lib/bleProtocol.ts`](../src/lib/bleProtocol.ts) exactly — if you change UUIDs, the control command bytes, or the angle payload layout on either side, update both.

- Service UUID `b5b2b8a0-0001-4f0a-9e0a-1a2b3c4d5e6f`
- Angle characteristic (notify, 8 bytes, little-endian): `uint32 millis`, `float32 angle`
- Control characteristic (write, 1 byte): `0x01` calibrate, `0x02` start streaming, `0x03` stop streaming

## Single-sensor mode

The hardware moved from two MPU6050s (thigh + shin) to one, mounted on the shin. The app-side analysis in `src/lib/motionAnalysis.ts` still computes `kneeAngle = |shinAngle - thighAngle|`; `src/lib/bleConnection.ts` now feeds it a fixed `thighAngle: 0` alongside the real streamed `shinAngle`, which is only correct if:

- **Calibration happens with the leg fully straight.** `calibrate()` zeroes the sensor's current pose — if that pose isn't full extension, every angle in the capture is offset by however bent the leg actually was at calibration time, and the app's 0°-is-straight convention (see `poseAnalysis.ts`) breaks.
- **The thigh genuinely doesn't move during the exercise.** True for seated knee extension (thigh rests on the chair) — the primary screening test this app's risk score is built around. **Not true for sit-to-stand**, where the thigh does most of the rotation and the shin stays roughly vertical throughout; a shin-only sensor mostly misses that motion. Sit-to-stand data is still captured and stored (and shown in the PDF report) but was already excluded from the risk-score calculation before this change (see `src/db/repositories/riskScores.ts` — only the knee-extension capture feeds `computeRiskScore()`), so this doesn't affect the classification result, just the sit-to-stand numbers' own accuracy.

## Known limitation: accelerometer axis assumption

`accelPitchDeg()` assumes a specific sensor-mounting orientation (see the comment above it in the `.ino`). If the calibration LED goes green but the angle doesn't change sensibly as you move the leg, the sensor is very likely mounted with a different face outward than assumed — swap which accelerometer axis (and the matching gyro axis, `g.gyro.y`) feeds the calculation.
