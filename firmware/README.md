# KneeSense NER — ESP32 firmware

Streams a shin orientation angle over BLE to the app (single-sensor mode — one MPU6050, shin-mounted; the earlier two-sensor thigh+shin design was dropped). See the wiring diagram and pin notes at the top of [`kneesense_esp32/kneesense_esp32.ino`](kneesense_esp32/kneesense_esp32.ino) — that file is the source of truth for wiring, not this README.

**Not compiled/flashed in this session** — there's no Arduino toolchain available here, so this needs to be verified on your machine before trusting it on real hardware.

## Setup (Arduino IDE)

1. **Board support**: File → Preferences → Additional Boards Manager URLs → add `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`, then Tools → Board → Boards Manager → install **esp32** (Espressif Systems).
2. **Board selection**: Tools → Board → ESP32 Arduino → **ESP32 Dev Module** (or your specific board if different).
3. **Libraries**: none to install. The MPU6050 is driven by direct I2C register access (`Wire.h`, which ships with the board package), not the Adafruit_MPU6050 library — see "MPU6050 direct register access" in the `.ino` for why and exactly what it replicates. The BLE library (`BLEDevice.h` etc.) also ships with the esp32 board package.
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

## If the app's device picker doesn't show the board

The device broadcasts as **`KS-NER`** (not "KneeSense-NER" — the longer name plus the 128-bit service UUID didn't fit in one legacy BLE advertising packet, 31 bytes max; see the comment above `BLE_DEVICE_NAME` in the `.ino`. That mismatch can make a device invisible to a services-filtered scan even while it's genuinely powered on and in range). If pairing still doesn't find it after reflashing with this name:

- Confirm the device you're testing *from* (laptop vs. phone) has Bluetooth turned on and is itself within range — seeing the board on one device (e.g. a phone's Bluetooth scan) says nothing about whether a different device (e.g. a laptop's Chrome) can see it; each has its own radio.
- A generic BLE scanner app (nRF Connect, LightBlue, Serial Bluetooth Terminal) confirms the board is advertising *something*, but check it specifically shows the `KS-NER` name and the `b5b2b8a0-0001-...` service UUID in its advertisement — not just that some device with a MAC address showed up.
- Retry a couple of times — Chrome's Web Bluetooth device chooser can take a few seconds to populate; closing it before it finishes throws `NotFoundError: User cancelled the requestDevice() chooser`, which looks like a real failure but may just be an early cancel.

## Protocol

Matches [`src/lib/bleProtocol.ts`](../src/lib/bleProtocol.ts) exactly — if you change UUIDs, the control command bytes, or the angle payload layout on either side, update both.

- Service UUID `b5b2b8a0-0001-4f0a-9e0a-1a2b3c4d5e6f`
- Angle characteristic (notify, 8 bytes, little-endian): `uint32 millis`, `float32 angle`
- Control characteristic (write, 1 byte): `0x01` calibrate, `0x02` start streaming, `0x03` stop streaming
- Status characteristic (read, 1 byte): bit 0 set = the firmware's *previous* boot was force-reset by the ESP32's brownout detector (input voltage sagged too low) — see "Low-power detection" below. The app reads this once right after connecting, not via notify, since it only changes across a reboot.

## Low-power detection

This board runs off **USB from a power bank**, not a raw LiPo cell wired directly to the ESP32 — confirmed with the project owner. That means there is no battery-voltage rail anywhere on this board for the firmware to read: a power bank just supplies a regulated 5V until it can't anymore, and hides its own internal cell level entirely. True proactive "battery at 20%" monitoring isn't possible with this power architecture without opening the power bank itself, which isn't a reasonable ask.

The one real signal that *is* available at zero extra wiring: the ESP32 has a **hardware brownout detector** that force-resets the chip if the input rail sags too low (a classic symptom of a power bank running low under load). `setup()` checks `esp_reset_reason()` on every boot and remembers if the *previous* boot ended in a brownout, then reports it over the status characteristic above. `SensorPairingPage` in the app shows an amber "possible low-power reset" popup after connecting if this bit is set.

Caveats to know about this approach:
- **It's retrospective, not live.** You find out after reconnecting, following a reset — not with a countdown while a capture is running. A power bank that fails abruptly mid-capture will instead surface as an ordinary BLE disconnect (see `bleConnection.ts`'s `onDisconnect`), which the app also handles (discards the partial capture, shows a popup).
- **It only reports the most recent boot.** If the board boots, connects fine, and only later browns out mid-session without a full reset, this bit won't reflect that specific event — a mid-session voltage sag severe enough to matter almost always does cause a reset in practice, but it's not guaranteed.
- If you want a live, predictive warning instead (e.g. "reconnect now, ~2 minutes of runtime left"), that needs a real hardware change: tap the 5V/VIN rail *before* the ESP32's onboard regulator through a resistor divider into a spare ADC-capable pin (e.g. GPIO34), and have the firmware watch for the rail starting to sag below a threshold rather than waiting for a full brownout reset. Not implemented — flag it if you want this added once the wiring is decided.

## Single-sensor mode

The hardware moved from two MPU6050s (thigh + shin) to one, mounted on the shin. The app-side analysis in `src/lib/motionAnalysis.ts` still computes `kneeAngle = |shinAngle - thighAngle|`; `src/lib/bleConnection.ts` now feeds it a fixed `thighAngle: 0` alongside the real streamed `shinAngle`, which is only correct if:

- **Calibration happens with the leg fully straight.** `calibrate()` zeroes the sensor's current pose — if that pose isn't full extension, every angle in the capture is offset by however bent the leg actually was at calibration time, and the app's 0°-is-straight convention (see `poseAnalysis.ts`) breaks.
- **The thigh genuinely doesn't move during the exercise.** True for seated knee extension (thigh rests on the chair) — the primary screening test this app's risk score is built around. **Not true for sit-to-stand**, where the thigh does most of the rotation and the shin stays roughly vertical throughout; a shin-only sensor mostly misses that motion. Sit-to-stand data is still captured and stored (and shown in the PDF report) but was already excluded from the risk-score calculation before this change (see `src/db/repositories/riskScores.ts` — only the knee-extension capture feeds `computeRiskScore()`), so this doesn't affect the classification result, just the sit-to-stand numbers' own accuracy.

## Known limitation: accelerometer axis assumption

`accelPitchDeg()` assumes a specific sensor-mounting orientation (see the comment above it in the `.ino`). If the calibration LED goes green but the angle doesn't change sensibly as you move the leg, the sensor is very likely mounted with a different face outward than assumed — swap which accelerometer axis (and the matching gyro axis, `g.gyro.y`) feeds the calculation.
