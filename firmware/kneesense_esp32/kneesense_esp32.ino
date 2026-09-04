/*
  KneeSense NER — ESP32 firmware (single-sensor mode, MPU6050 only)

  One MPU6050 (shin-mounted) -> complementary filter -> knee angle stream
  over BLE. Matches the app-side protocol in src/lib/bleProtocol.ts — if you
  change the UUIDs or the payload layout, update both sides.

  No calibration button, RGB LED, buzzer, or vibration motor on this board —
  just the MPU6050. That means there is NO on-device physical feedback at
  all: calibration is triggered only over BLE (the app's "Calibrate" button
  on SensorPairingPage sends CMD_CALIBRATE — this always worked over BLE
  too, so nothing is lost there), and the only status indicators are the
  Serial Monitor (wiring/boot problems) and the app's own UI (connection
  state, calibration state, and the error popups it already shows for
  BLE failures). If you add any of that hardware back later, wire it in
  parallel to this file's BLE/sensor logic — it never touched the protocol.

  Single-sensor convention: the thigh is assumed to stay still during the
  seated knee-extension test (it rests on the chair), so the app treats the
  thigh's angle as a fixed 0° reference and computes knee angle directly
  from this sensor's angle. That assumption only holds if you CALIBRATE
  WITH THE LEG FULLY STRAIGHT (see calibrate() below) — calibrating at any
  other position shifts the whole 0°-reference and throws off every
  downstream ROM/smoothness number.

  Power: this board runs off USB from a power bank, not a raw LiPo cell, so
  there is no battery-voltage rail to sense directly. The one available
  low-power signal is the ESP32's own brownout detector — see
  lastResetWasBrownout / STATUS_CHAR_UUID below.

  ---------------------------------------------------------------------
  WIRING
  ---------------------------------------------------------------------
  ESP32 3.3V   -> MPU6050 VCC
  ESP32 GND    -> MPU6050 GND
  ESP32 GPIO21 -> MPU6050 SDA
  ESP32 GPIO22 -> MPU6050 SCL

  MPU6050: AD0 -> GND (I2C address 0x68), strapped to the outer shin,
    8-12cm below the knee, pointing toward the hip (same orientation the
    app's pairing screen instructs for a patient).

  ---------------------------------------------------------------------
  LIBRARIES (install via Arduino IDE Library Manager)
  ---------------------------------------------------------------------
  None beyond what ships with the ESP32 board package (Wire.h for I2C,
  BLEDevice.h etc. for BLE). The MPU6050 is driven by direct register
  reads/writes (see "MPU6050 direct register access" below) rather than
  the Adafruit_MPU6050 library, to skip that library's init overhead.
*/

#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_system.h>

// ---------------- Pins ----------------
const int PIN_SDA = 21;
const int PIN_SCL = 22;

// ---------------- I2C address ----------------
const uint8_t MPU_ADDR = 0x68; // AD0 -> GND

// ---------------- BLE protocol (see src/lib/bleProtocol.ts) ----------------
#define SERVICE_UUID       "b5b2b8a0-0001-4f0a-9e0a-1a2b3c4d5e6f"
#define ANGLE_CHAR_UUID    "b5b2b8a0-0002-4f0a-9e0a-1a2b3c4d5e6f"
#define CONTROL_CHAR_UUID  "b5b2b8a0-0003-4f0a-9e0a-1a2b3c4d5e6f"
#define STATUS_CHAR_UUID   "b5b2b8a0-0004-4f0a-9e0a-1a2b3c4d5e6f"

const uint8_t CMD_CALIBRATE       = 0x01;
const uint8_t CMD_START_STREAMING = 0x02;
const uint8_t CMD_STOP_STREAMING  = 0x03;

// Bit 0 of the status byte (see STATUS_CHAR_UUID below).
const uint8_t STATUS_BIT_LAST_RESET_BROWNOUT = 0x01;

bool sensorOk = false;
// There's no battery-voltage sensing on this board (USB power bank supply
// has no exposed cell voltage to read) — the ESP32's own brownout detector
// is the only available low-power signal: it force-resets the chip if the
// input rail sags too low, and remembers why on the next boot. This is
// retrospective (found out after the fact, not a live warning), but it's
// a real signal at zero extra wiring, unlike a made-up placeholder.
bool lastResetWasBrownout = false;

// Complementary-filter state. Angle convention matches the app's
// motionAnalysis.ts: 0deg = leg fully straight (the calibration pose),
// larger = more bent.
float shinAngle = 0;
float gyroBiasRadS = 0;
unsigned long lastSampleMicros = 0;

BLECharacteristic *angleChar;
BLECharacteristic *controlChar;
BLECharacteristic *statusChar;
bool deviceConnected = false;
bool streaming = false;

// ---------------- MPU6050 direct register access ----------------
// Talks to the MPU6050 directly over Wire per its register map, instead of
// through Adafruit_MPU6050 — that library's begin()/getEvent() adds I2C
// round-trips and general-purpose-sensor overhead this firmware doesn't
// need. Configured to match what the Adafruit library was set to before
// (so the angle math below is numerically unchanged): +/-4g accel range,
// +/-500deg/s gyro range, ~21Hz DLPF bandwidth. If you change any of these
// three, update the matching *_LSB_PER_* constant below too, or every
// downstream angle will be silently scaled wrong.
const uint8_t MPU_REG_WHO_AM_I     = 0x75;
const uint8_t MPU_REG_PWR_MGMT_1   = 0x6B;
const uint8_t MPU_REG_CONFIG       = 0x1A;
const uint8_t MPU_REG_GYRO_CONFIG  = 0x1B;
const uint8_t MPU_REG_ACCEL_CONFIG = 0x1C;
const uint8_t MPU_REG_ACCEL_XOUT_H = 0x3B;

const float ACCEL_LSB_PER_G  = 8192.0f; // AFS_SEL=1 -> +/-4g (see mpuBegin())
const float GYRO_LSB_PER_DPS = 65.5f;   // FS_SEL=1  -> +/-500deg/s (see mpuBegin())
const float G_TO_MS2         = 9.80665f;
const float DEG_TO_RAD       = PI / 180.0f;

// Physical-unit accel/gyro reading, same convention Adafruit's
// sensors_event_t used (accel in m/s^2, gyro in rad/s) so the math below
// didn't need to change when this replaced that library. Only gyroY is
// kept (the only axis this firmware's complementary filter uses).
struct ImuSample {
  float accelX, accelY, accelZ;
  float gyroY;
};

void mpuWriteReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

uint8_t mpuReadReg(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false); // repeated start, keep the bus held for the read
  Wire.requestFrom(MPU_ADDR, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0;
}

// Same "did the sensor actually respond" check Adafruit_MPU6050's begin()
// did (WHO_AM_I must read back 0x68) — kept so sensorOk / the Serial "not
// found" message still work. Also wakes the chip (it boots with the sleep
// bit set in PWR_MGMT_1) and configures the same ranges/filter the
// Adafruit library used to.
bool mpuBegin() {
  if (mpuReadReg(MPU_REG_WHO_AM_I) != 0x68) return false;
  mpuWriteReg(MPU_REG_PWR_MGMT_1, 0x00);   // clear sleep bit
  mpuWriteReg(MPU_REG_CONFIG, 0x04);       // DLPF_CFG=4 -> ~21Hz accel bandwidth
  mpuWriteReg(MPU_REG_GYRO_CONFIG, 0x08);  // FS_SEL=1  -> +/-500deg/s
  mpuWriteReg(MPU_REG_ACCEL_CONFIG, 0x08); // AFS_SEL=1 -> +/-4g
  return true;
}

// Burst-reads all 14 accel+temp+gyro bytes in one I2C transaction (starting
// at ACCEL_XOUT_H, the datasheet's standard contiguous block) and converts
// to the physical units the rest of this file expects. Temperature and the
// unused gyro axes are read (the burst is contiguous, so skipping them
// would need extra transactions, not fewer bytes) and discarded.
ImuSample mpuReadSample() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(MPU_REG_ACCEL_XOUT_H);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (uint8_t)14);

  int16_t rawAx = (Wire.read() << 8) | Wire.read();
  int16_t rawAy = (Wire.read() << 8) | Wire.read();
  int16_t rawAz = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read(); // temperature - unused
  Wire.read(); Wire.read(); // gyro X - unused (only gyro Y feeds the filter)
  int16_t rawGy = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read(); // gyro Z - unused

  ImuSample s;
  s.accelX = (rawAx / ACCEL_LSB_PER_G) * G_TO_MS2;
  s.accelY = (rawAy / ACCEL_LSB_PER_G) * G_TO_MS2;
  s.accelZ = (rawAz / ACCEL_LSB_PER_G) * G_TO_MS2;
  s.gyroY  = (rawGy / GYRO_LSB_PER_DPS) * DEG_TO_RAD;
  return s;
}

// ---------------- Sensor math ----------------

// Pitch around the mediolateral (side-to-side) axis, from the
// accelerometer alone — noisy but drift-free. This is the axis a
// side-strapped sensor rotates around during knee flexion/extension.
// If your sensor is mounted with a different face outward, you may need
// to swap which accel axis feeds this (and the matching gyro axis below)
// — check with a slow known motion via Serial or the app's live angle.
float accelPitchDeg(const ImuSample &a) {
  return atan2(a.accelY, sqrt(a.accelX * a.accelX + a.accelZ * a.accelZ)) * 180.0 / PI;
}

// Calibrates while the leg is held straight and still: takes the
// accelerometer's current reading as the zero (= fully-extended) reference
// for the complementary filter, and measures the gyro's stationary bias so
// it doesn't integrate a slow drift over a multi-minute screening session.
// MUST be run with the leg fully extended — the app computes knee angle
// directly from this sensor's angle, so whatever pose it's calibrated in
// becomes "0 degrees" for the rest of the capture. Only triggered over BLE
// (CMD_CALIBRATE, via the app's Calibrate button) — there's no physical
// button on this board.
void calibrate() {
  Serial.println("Calibrating — hold the leg straight and still...");
  const int N = 100;
  float angleSum = 0;
  float gyroSum = 0;

  for (int i = 0; i < N; i++) {
    ImuSample s = mpuReadSample();
    angleSum += accelPitchDeg(s);
    gyroSum += s.gyroY;
    delay(10);
  }

  shinAngle = angleSum / N;
  gyroBiasRadS = gyroSum / N;
  lastSampleMicros = micros();

  Serial.println("Calibrated.");
}

// ---------------- BLE callbacks ----------------

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
  }
  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    streaming = false;
    server->getAdvertising()->start(); // resume advertising so the app can reconnect
  }
};

class ControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    std::string v = c->getValue();
    if (v.length() == 0) return;
    uint8_t cmd = (uint8_t)v[0];
    if (cmd == CMD_CALIBRATE) {
      calibrate();
    } else if (cmd == CMD_START_STREAMING) {
      streaming = true;
    } else if (cmd == CMD_STOP_STREAMING) {
      streaming = false;
    }
  }
};

// A legacy BLE advertising packet is capped at 31 bytes total. Flags (3
// bytes) + our 128-bit service UUID (2-byte header + 16 bytes = 18 bytes)
// already use 21 of those — "KneeSense-NER" as the device name would need
// 15 more (36 total, over the limit), which can make the ESP32 BLE stack
// silently drop or split the service UUID out of the primary advertisement.
// Since the app's requestDevice({services:[SERVICE_UUID]}) filters ON that
// UUID, a device broadcasting it outside the primary packet may just never
// show up in the picker even though it's genuinely in range and powered on.
// Keep this short enough that everything fits in one packet with margin.
#define BLE_DEVICE_NAME "KS-NER"

void setupBle() {
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);

  angleChar = service->createCharacteristic(ANGLE_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  angleChar->addDescriptor(new BLE2902());

  controlChar = service->createCharacteristic(CONTROL_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  controlChar->setCallbacks(new ControlCallbacks());

  // Read-once status byte — the app reads this right after connecting (see
  // bleConnection.ts) rather than subscribing to it, since it only changes
  // across a reboot, not during a session.
  statusChar = service->createCharacteristic(STATUS_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
  uint8_t statusByte = lastResetWasBrownout ? STATUS_BIT_LAST_RESET_BROWNOUT : 0x00;
  statusChar->setValue(&statusByte, 1);

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
}

// ---------------- Setup / loop ----------------

void setup() {
  Serial.begin(115200);

  lastResetWasBrownout = (esp_reset_reason() == ESP_RST_BROWNOUT);
  if (lastResetWasBrownout) {
    Serial.println("Last reset was caused by a brownout (input voltage sagged too low) — check the power bank/USB supply.");
  }

  Wire.begin(PIN_SDA, PIN_SCL);

  sensorOk = mpuBegin();
  if (!sensorOk) {
    Serial.println("MPU6050 (0x68) not found — check wiring/AD0");
  } else {
    Serial.println("MPU6050 found and configured.");
  }

  setupBle();

  if (sensorOk) {
    calibrate(); // initial calibration (leg must be straight); re-run any time via a BLE 0x01 command
  }
}

void loop() {
  if (!streaming || !deviceConnected || !sensorOk) return;

  unsigned long now = micros();
  float dt = (now - lastSampleMicros) / 1000000.0;
  if (dt < 0.02) return; // ~50 Hz cap
  lastSampleMicros = now;

  ImuSample s = mpuReadSample();
  float accelAngle = accelPitchDeg(s);

  // Complementary filter: mostly trust the integrated (bias-corrected)
  // gyro rate for smooth, low-latency motion, and slowly pull toward the
  // accelerometer's absolute (but noisy) reading so the estimate can't
  // drift indefinitely. 0.98 is a common starting point for a ~50 Hz loop
  // — raise it for smoother-but-slower drift correction, lower it if the
  // angle visibly drifts during a long capture.
  const float ALPHA = 0.98;
  shinAngle = ALPHA * (shinAngle + (s.gyroY - gyroBiasRadS) * dt * 180.0 / PI) + (1 - ALPHA) * accelAngle;

  // 8-byte payload: uint32 millis-since-boot, float32 angle (see
  // src/lib/bleProtocol.ts — single-sensor mode dropped the second float).
  uint8_t payload[8];
  uint32_t t = millis();
  memcpy(payload, &t, 4);
  memcpy(payload + 4, &shinAngle, 4);
  angleChar->setValue(payload, 8);
  angleChar->notify();
}
