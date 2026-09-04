/*
  KneeSense NER — ESP32 firmware (single-sensor mode)

  One MPU6050 (shin-mounted) -> complementary filter -> knee angle stream
  over BLE. Matches the app-side protocol in src/lib/bleProtocol.ts — if you
  change the UUIDs or the payload layout, update both sides.

  Single-sensor convention: the thigh is assumed to stay still during the
  seated knee-extension test (it rests on the chair), so the app treats the
  thigh's angle as a fixed 0° reference and computes knee angle directly
  from this sensor's angle. That assumption only holds if you CALIBRATE
  WITH THE LEG FULLY STRAIGHT (see calibrate() below) — calibrating at any
  other position shifts the whole 0°-reference and throws off every
  downstream ROM/smoothness number.

  ---------------------------------------------------------------------
  WIRING
  ---------------------------------------------------------------------
  ESP32 3.3V   -> MPU6050 VCC
  ESP32 GND    -> MPU6050 GND, buzzer -, LED cathode(s), transistor
                  emitter, calibration button's pull-down leg
  ESP32 GPIO21 -> MPU6050 SDA
  ESP32 GPIO22 -> MPU6050 SCL

  MPU6050: AD0 -> GND (I2C address 0x68), strapped to the outer shin,
    8-12cm below the knee, pointing toward the hip (same orientation the
    app's pairing screen instructs for a patient).

  Calibration button: one leg -> 3.3V, other leg -> GPIO4 AND -> 10k
    resistor -> GND (external pull-down; button press reads HIGH)

  RGB LED (common cathode): R -> 220ohm -> GPIO25, G -> 220ohm -> GPIO26,
    B -> 220ohm -> GPIO27, cathode -> GND

  Active buzzer: + -> GPIO32, - -> GND

  Vibration motor (needs a transistor — never drive a motor from a GPIO
  directly): GPIO33 -> 1k resistor -> transistor base (2N2222/BC547) ->
    transistor emitter -> GND, transistor collector -> motor -,
    motor + -> 3.3V (or 5V from the power bank if the motor needs it),
    1N4001/1N4007 flyback diode across the motor terminals (cathode/banded
    end to motor +, anode to motor -) to protect the transistor from the
    motor's back-EMF when it switches off.

  ---------------------------------------------------------------------
  LIBRARIES (install via Arduino IDE Library Manager)
  ---------------------------------------------------------------------
  - Adafruit MPU6050
  - Adafruit Unified Sensor
  - Adafruit BusIO
  (ESP32's built-in BLE library — BLEDevice.h etc. — ships with the
  ESP32 board package, nothing extra to install for that part.)
*/

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---------------- Pins ----------------
const int PIN_SDA = 21;
const int PIN_SCL = 22;
const int PIN_CALIBRATE_BTN = 4;
const int PIN_LED_R = 25;
const int PIN_LED_G = 26;
const int PIN_LED_B = 27;
const int PIN_BUZZER = 32;
const int PIN_MOTOR = 33;

// ---------------- I2C address ----------------
const uint8_t MPU_ADDR = 0x68; // AD0 -> GND

// ---------------- BLE protocol (see src/lib/bleProtocol.ts) ----------------
#define SERVICE_UUID       "b5b2b8a0-0001-4f0a-9e0a-1a2b3c4d5e6f"
#define ANGLE_CHAR_UUID    "b5b2b8a0-0002-4f0a-9e0a-1a2b3c4d5e6f"
#define CONTROL_CHAR_UUID  "b5b2b8a0-0003-4f0a-9e0a-1a2b3c4d5e6f"

const uint8_t CMD_CALIBRATE       = 0x01;
const uint8_t CMD_START_STREAMING = 0x02;
const uint8_t CMD_STOP_STREAMING  = 0x03;

Adafruit_MPU6050 mpu;
bool sensorOk = false;

// Complementary-filter state. Angle convention matches the app's
// motionAnalysis.ts: 0deg = leg fully straight (the calibration pose),
// larger = more bent.
float shinAngle = 0;
float gyroBiasRadS = 0;
unsigned long lastSampleMicros = 0;

BLECharacteristic *angleChar;
BLECharacteristic *controlChar;
bool deviceConnected = false;
bool streaming = false;

// ---------------- Feedback helpers ----------------

void setColor(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_R, r ? HIGH : LOW);
  digitalWrite(PIN_LED_G, g ? HIGH : LOW);
  digitalWrite(PIN_LED_B, b ? HIGH : LOW);
}

void beep(int ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

void buzzVibrate(int ms) {
  digitalWrite(PIN_MOTOR, HIGH);
  delay(ms);
  digitalWrite(PIN_MOTOR, LOW);
}

// ---------------- Sensor math ----------------

// Pitch around the mediolateral (side-to-side) axis, from the
// accelerometer alone — noisy but drift-free. This is the axis a
// side-strapped sensor rotates around during knee flexion/extension.
// If your sensor is mounted with a different face outward, you may need
// to swap which accel axis feeds this (and the matching gyro axis below)
// — check with the calibration LED + a slow known motion.
float accelPitchDeg(sensors_event_t &a) {
  return atan2(a.acceleration.y, sqrt(a.acceleration.x * a.acceleration.x + a.acceleration.z * a.acceleration.z)) * 180.0 / PI;
}

// Calibrates while the leg is held straight and still: takes the
// accelerometer's current reading as the zero (= fully-extended) reference
// for the complementary filter, and measures the gyro's stationary bias so
// it doesn't integrate a slow drift over a multi-minute screening session.
// MUST be run with the leg fully extended — the app computes knee angle
// directly from this sensor's angle, so whatever pose it's calibrated in
// becomes "0 degrees" for the rest of the capture.
void calibrate() {
  setColor(true, false, false); // red = calibrating, don't move
  const int N = 100;
  float angleSum = 0;
  float gyroSum = 0;

  for (int i = 0; i < N; i++) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    angleSum += accelPitchDeg(a);
    gyroSum += g.gyro.y;
    delay(10);
  }

  shinAngle = angleSum / N;
  gyroBiasRadS = gyroSum / N;
  lastSampleMicros = micros();

  setColor(false, true, false); // green = calibrated / ready
  beep(150);
  buzzVibrate(150);
}

// ---------------- BLE callbacks ----------------

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
    setColor(false, false, true); // blue = connected
  }
  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    streaming = false;
    setColor(false, true, false);
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

void setupBle() {
  BLEDevice::init("KneeSense-NER");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);

  angleChar = service->createCharacteristic(ANGLE_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  angleChar->addDescriptor(new BLE2902());

  controlChar = service->createCharacteristic(CONTROL_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  controlChar->setCallbacks(new ControlCallbacks());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
}

// ---------------- Setup / loop ----------------

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_SDA, PIN_SCL);

  pinMode(PIN_CALIBRATE_BTN, INPUT); // external pull-down — see wiring notes
  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_MOTOR, OUTPUT);
  setColor(false, false, true); // blue = starting up

  sensorOk = mpu.begin(MPU_ADDR);
  if (!sensorOk) Serial.println("MPU6050 (0x68) not found — check wiring/AD0");

  if (!sensorOk) {
    // Solid red = the sensor didn't respond. Fix wiring and reset the board.
    setColor(true, false, false);
  } else {
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  setupBle();

  if (sensorOk) {
    calibrate(); // initial calibration (leg must be straight); re-run any time via the button or a BLE 0x01 command
  }
}

void loop() {
  static bool lastBtn = LOW;
  bool btn = digitalRead(PIN_CALIBRATE_BTN);
  if (btn == HIGH && lastBtn == LOW && sensorOk) {
    calibrate();
  }
  lastBtn = btn;

  if (!streaming || !deviceConnected || !sensorOk) return;

  unsigned long now = micros();
  float dt = (now - lastSampleMicros) / 1000000.0;
  if (dt < 0.02) return; // ~50 Hz cap
  lastSampleMicros = now;

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  float accelAngle = accelPitchDeg(a);

  // Complementary filter: mostly trust the integrated (bias-corrected)
  // gyro rate for smooth, low-latency motion, and slowly pull toward the
  // accelerometer's absolute (but noisy) reading so the estimate can't
  // drift indefinitely. 0.98 is a common starting point for a ~50 Hz loop
  // — raise it for smoother-but-slower drift correction, lower it if the
  // angle visibly drifts during a long capture.
  const float ALPHA = 0.98;
  shinAngle = ALPHA * (shinAngle + (g.gyro.y - gyroBiasRadS) * dt * 180.0 / PI) + (1 - ALPHA) * accelAngle;

  // 8-byte payload: uint32 millis-since-boot, float32 angle (see
  // src/lib/bleProtocol.ts — single-sensor mode dropped the second float).
  uint8_t payload[8];
  uint32_t t = millis();
  memcpy(payload, &t, 4);
  memcpy(payload + 4, &shinAngle, 4);
  angleChar->setValue(payload, 8);
  angleChar->notify();
}
