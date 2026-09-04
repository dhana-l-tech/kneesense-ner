# KneeSense NER

Offline-first React + TypeScript app (Vite), packaged for native mobile via Capacitor. Local SQLite is the source of truth; Supabase is a background sync target only — see [`src/db/schema.sql`](src/db/schema.sql) and [`src/lib/sync.ts`](src/lib/sync.ts).

## Setup

```bash
npm install
cp .env.example .env   # fill in Supabase URL/anon key when you have a project (optional — app runs fully offline without it)
npm run dev
```

## Auth & encryption

Three independent mechanisms — deliberately not tangled together, so a forgotten PIN can never make data unrecoverable, and signing out of a cloud account never locks you out of the device:

- **App lock (device-local, offline)** — `src/components/PinGate.tsx` wraps the whole app. First launch sets a 4-digit PIN (SHA-256, salted per-install, via Web Crypto — `src/lib/pinAuth.ts`); every subsequent launch requires it. There's no "unlocked" flag persisted anywhere, so it re-locks on every real app restart (confirmed live: a reload always re-shows the PIN screen). "Forgot PIN?" resets it directly — no recovery flow needed, because resetting the PIN never touches the encrypted data below. This is a **device-access gate**, not an identity system — it doesn't know or care which health worker is using the phone.
- **Encryption at rest (native only)** — `src/db/client.ts` now opens the native SQLite connection encrypted (SQLCipher, via `@capacitor-community/sqlite`'s built-in support). A random 256-bit passphrase is generated once per install and handed to the plugin's own secure store (`setEncryptionSecret` — backed by Android Keystore / iOS Keychain, not anything this app manages directly); every later launch just reuses it. The web dev fallback (`sql.js`/IndexedDB) stays unencrypted — it's dev-only storage, not the shipped target.
- **Supabase Auth identity (optional, cloud sync only)** — `src/lib/supabaseAuth.ts` + `src/pages/AccountPage.tsx` (reachable via "Account" on the patient list). A health worker can optionally sign in/up with email+password; `createPatient()` (`patients.ts`) now auto-attributes new patients to the signed-in user's id via a **local, no-network read of the cached session** (`getCurrentUser()`), so this costs nothing offline — only the initial sign-in/sign-up itself needs connectivity. This is what finally makes `supabase/rls.sql`'s `created_by = auth.uid()` policies meaningful once a project is connected.

**What's verified vs. not:** the PIN gate is fully tested live — setup, confirm-mismatch handling, correct/incorrect verification, reload re-locking, and the reset flow all confirmed working (including catching a real bug in an early test where rapid synchronous test-script clicks exposed a stale-closure timing issue — harmless for real usage, since genuine taps are never batched like that, but worth knowing about if you ever script-drive this screen). The Supabase Auth module was live-verified for its unconfigured-project path (clean error objects, no throws, `created_by` correctly stays `null`, zero regression to registering a patient) — the actual sign-in/sign-up network round trip can't be tested here since no live Supabase project is connected. The encryption path can't be exercised at all in this environment — the SQLCipher connection only runs on native, and there's no Android/iOS build running here (see "Android build" below) — so it's implemented against the plugin's documented API but not yet confirmed against a real encrypted database on a device.

`supabase/rls.sql` is now genuinely close to appliable — `created_by` gets populated for real once someone signs in — but still needs a real Supabase project with the `schema.sql` applied and at least one account created before it makes sense to turn on.

## Architecture

- `src/db/schema.sql` — the local SQLite schema (patients, sessions, questionnaire, exercise captures, camera features, risk scores, reports, sync outbox).
- `src/db/client.ts` — opens the local DB. On native (Android/iOS) this talks to real platform SQLite via `@capacitor-community/sqlite`. On web (`npm run dev` / a plain browser build) it uses `src/db/webAdapter.ts`, a small `sql.js`-backed adapter that persists to IndexedDB — **only used for browser-based dev/testing**, not the shipped native app.
- `src/db/types.ts` — the `DbHandle` interface both backends implement, so repositories don't care which one they're talking to.
- `src/db/outbox.ts` + `src/lib/sync.ts` — outbox-pattern sync: writes never touch the network; a background worker drains queued rows to Supabase when `@capacitor/network` reports connectivity.
- `src/db/repositories/` — typed read/write functions per table (e.g. `patients.ts`).
- `src/types/models.ts` — TypeScript types mirroring `schema.sql` 1:1, so the same shapes work for local rows and Supabase rows.

(Earlier iteration used `@capacitor-community/sqlite`'s own web implementation, `jeep-sqlite` — it hung unrecoverably in some browser contexts with no thrown error, so it was replaced with the simpler direct `sql.js` adapter above.)

## Multilingual support

- `src/i18n/translations/en.ts` — the canonical string keys (`'patients.registerButton'`, etc). Every other locale file is typed as `Record<MessageKey, string>` against this one, so a missing translation is a **TypeScript compile error**, not a silently-broken screen — this caught nothing by the time of writing, but it's there so it will next time a key gets added.
- `src/i18n/translations/{as,bn,mni}.ts` — Assamese, Bengali, Manipuri.
- `src/i18n/I18nContext.tsx` — `I18nProvider` + `useTranslation()` (`t(key, vars?)` with `{name}` interpolation), language choice persisted to `localStorage`.
- `src/components/LanguageSwitcher.tsx` — shown at the top of the patient list (the app's entry point), so switching language never requires an extra mandatory step in the workflow.
- The selected language is saved with each questionnaire as `questionnaire_responses.language_used` (already existed in the schema — now actually populated instead of hardcoded to `'en'`).

**Translation confidence, honestly:** I have solid confidence in Bengali and reasonable confidence in Assamese — both reviewed key-by-key, not machine-translated wholesale. **Manipuri is different: I don't have reliable training data for Meitei, in either Bengali script or Meitei Mayek, and this app collects clinical symptom data.** A confidently-wrong medical translation is worse than an honest gap, so `mni.ts` deliberately mirrors English rather than guessing — it's wired up end-to-end (selectable, persisted, recorded in `language_used`) so a real translation is a pure content fill-in later, but right now Manipuri-selecting users just see English. **Bengali and Assamese should still get a native-speaking clinician's review before real deployment** — I'm more confident in them than in a guess, not certain they're clinically polished.

**Not localized:** the PDF report (`reportGenerator.ts`) is still English-only. `jsPDF`'s built-in fonts don't support Bengali-script rendering at all, so localizing it means embedding a custom font file — a real follow-up task, not just more translation keys.

Verified live in-browser: full patient-registration-through-results run completed entirely in Bengali (including every interpolated string — sample counts, walk-test time/steps/pauses, sync-pending counts), the selected language persists across a reload, and `language_used` was confirmed saved as `'bn'` in the actual database row. Assamese spot-checked separately and confirmed genuinely distinct from Bengali (different vocabulary and script conventions), not a copy-paste.

## Screening flow (implemented so far)

`Patients (register) → New session (knee + prior injury) → Questionnaire → Knee-extension capture → Sit-to-stand → Walk test → Results`

- `src/lib/motionAnalysis.ts` — knee angle (`|shin − thigh|`), ROM, jerk-based smoothness, rep counting (proper topographic-prominence peak detection). Shared by both the knee-extension and sit-to-stand captures.
- `src/lib/sensorSource.ts` — **simulated** signals (`SimulatedKneeExtensionSource`, `SimulatedSitToStandSource`), used as a dev-only fallback when no ESP32 is paired (see "Real ESP32 + BLE" below for the real link). The capture pages don't care which is active since both implement the same `AngleSample`-producing `SensorSource` interface.
- `src/pages/SitToStandPage.tsx` — safety-check gate first (spec says "if appropriate" — a "No" skips the test without affecting the score), then the same start/stop capture pattern as the knee-extension screen, reusing `saveExerciseCapture`. Sit-to-stand data is captured and stored (for the report and future ML dataset) but not yet folded into `riskScoring.ts` — the spec's weight table doesn't carve out a separate bucket for it.
- `src/pages/WalkTestPage.tsx` + `src/db/repositories/walkTest.ts` — timer-based walk test: tap counters for steps/pauses (no typing), assistance yes/no, gait-irregularity rating; computes speed (m/s) and cadence (steps/min) from distance and elapsed time. Elapsed time is measured directly from `performance.now()` deltas at start/stop, not accumulated from a UI-refresh timer, so it stays accurate even if the tab is backgrounded.
- `src/lib/riskScoring.ts` — rule-based risk scoring per the project spec's weights (symptoms 30% / ROM 25% / movement quality 15% / mobility 20% / sensor-camera agreement 10%), producing a `low` / `moderate` / `high` category. The mobility component blends reported difficulty with the walk test's objective speed/pauses/assistance/gait-irregularity when available. Pure function, unit-verified against synthetic low/moderate/high cases and against good-walk/bad-walk cases. This is a **cross-check design, not a fusion** — the camera's angle never replaces or averages with the IMU's ROM measurement; it only produces the separate 10% agreement score (and is dropped entirely below 50% confidence, per spec). The IMU stays the primary signal for the 40% ROM + movement-quality weight.
- **Simulated-data safety gate** — every `exercise_captures` row now records `data_source` (`'ble'` / `'simulated'` / `'manual'`, set from `isSensorConnected()` at capture time in `ExerciseCapturePage.tsx`/`SitToStandPage.tsx`). `computeAndSaveRiskScore()` (`riskScores.ts`) throws `SimulatedCaptureError` rather than silently scoring a session whose knee-extension capture used the dev-only simulator (no ESP32 connected) — `ResultsPage.tsx` catches it and shows a dedicated "reconnect the sensor and recapture" screen instead of a fabricated risk category. Closes a real gap where a dropped BLE connection could otherwise produce a plausible-looking but meaningless clinical result with no record afterward that it wasn't real sensor data.
- `src/pages/ResultsPage.tsx` — displays the category, score breakdown, the required non-diagnostic disclaimer ("OA risk markers" wording only — never "has osteoarthritis"), and a "Download PDF report" button.
- `src/lib/reportGenerator.ts` + `src/db/repositories/reports.ts` — builds the offline PDF report (patient/session info, symptoms, both exercise captures, walk test, camera cross-check status, risk breakdown, disclaimer) with `jspdf`. On native it writes to `Directory.Documents/KneeSenseReports/` via `@capacitor/filesystem`; on web it triggers a normal browser download. The `reports` table row (metadata only, not the PDF bytes) syncs to Supabase through the same outbox as everything else.

All verified end-to-end live in-browser, including full runs through both the sit-to-stand "proceed" and "skip" paths, and a full PDF download with content verified against the source data.

## Dashboard

Reachable from the patient list ("Dashboard"). Aggregate stats across every patient on this device — total patients, screenings completed, screenings in the last 7 days, risk-category distribution, age-group and location breakdowns, and the 10 most recent screenings with their risk badge. Everything is computed with local SQL queries against the on-device database (`src/db/repositories/dashboard.ts`) — no Supabase round trip, so it works fully offline like everything else. Bar charts are plain CSS (`.bar-chart`/`.bar-fill` in `index.css`), not a charting library, consistent with the rest of the app's minimal-dependency approach.

One real bug this caught during design (not by accident — I checked for it going in): `computeAndSaveRiskScore` always **inserts** a new `risk_scores` row rather than upserting, so revisiting a session's Results page leaves multiple rows behind. The risk-distribution query dedupes to the most recent row per session via a `ROW_NUMBER() OVER (PARTITION BY session_id ...)` window query — verified this actually matters: seeded 5 sessions with 2 conflicting `risk_scores` rows each (a stale `'low'` plus the real category), and the dashboard's counts matched only the latest row for all 5, not double-counted. All other numbers (patient/session counts, age and location breakdowns, recent-screenings list) were also checked against the seeded data and matched exactly.

## MediaPipe camera cross-check (optional)

On the knee-extension capture screen, an "Enable camera cross-check" toggle turns on a side-view webcam + MediaPipe `PoseLandmarker` running fully offline (model + WASM bundled locally — see `scripts/copy-mediapipe-assets.mjs`, run via `postinstall`, nothing fetched from a CDN at runtime).

- `src/lib/poseAnalysis.ts` — pure geometry: knee flexion angle from hip/knee/ankle landmarks (0° = straight, matching the IMU's convention so the two are directly comparable), confidence as average landmark visibility, and the spec's agreement classifier (≤5° agree, 6–10° check filtering, >10° mismatch). Verified against synthetic points (0°/90°/180° cases came out exact) and the classifier's boundaries.
- `src/lib/cameraSource.ts` — wraps `getUserMedia` + `PoseLandmarker.detectForVideo` in the same start/stop-with-callback shape as `sensorSource.ts`, tracking whichever leg matches the session's affected knee.
- `src/db/repositories/cameraFeatures.ts` — compares camera ROM against the IMU's ROM for the same capture, saves the `camera_features` row.
- `riskScoring.ts` / `riskScores.ts` — the previously-unused `imuCameraDiffDeg` slot is now wired up for real, but a camera reading below 50% confidence is dropped rather than counted against agreement ("if camera confidence is low, rely more on the IMU" — spec).
- The report and results screen show a mismatch/check-filtering warning when IMU and camera disagree, per spec.

**What's verified vs. what needs a real device:** the static assets load correctly (confirmed via direct fetch), the geometry/classification math is exact against synthetic data, and — importantly — `PoseLandmarker` initialization against the bundled WASM/model was confirmed working live (it runs *before* the camera-permission request in `cameraSource.ts`, and the failure this sandbox produces is specifically a `getUserMedia` permission rejection, not a model-loading error). The camera toggle is fully optional and fails gracefully — denying/lacking a camera doesn't affect the IMU capture at all, confirmed live. The actual live pose-detection loop against real video frames can only be exercised on a real device with a real camera, which this sandbox doesn't have.

## Real ESP32 + BLE

- [`firmware/kneesense_esp32/kneesense_esp32.ino`](firmware/kneesense_esp32/kneesense_esp32.ino) — **single-sensor mode**: one MPU6050 (shin-mounted) → complementary filter → BLE notify, plus the calibration button and RGB LED/buzzer/vibration-motor feedback from the original hardware plan. The hardware moved from an earlier two-sensor (thigh+shin) design to one sensor; the app's `bleConnection.ts` treats the un-instrumented thigh as a fixed 0° reference rather than the analysis code needing a rewrite — see `firmware/README.md`'s "Single-sensor mode" section for exactly what that assumes and where it breaks (sit-to-stand). Wiring diagram and setup steps are in [`firmware/README.md`](firmware/README.md). **Not compiled or flashed in this session** — no Arduino toolchain is available here, so it needs to be verified on real hardware before trusting it; the BLE payload math (8-byte little-endian layout) is separately unit-verified on the app side.
- `src/lib/bleProtocol.ts` — the shared contract (service/characteristic UUIDs, control command bytes, angle payload layout) between the firmware and the app. Keep both in sync if either changes.
- `src/lib/bleConnection.ts` — a persistent, module-level BLE connection (pair once after attaching the sensor, reuse across knee-extension + sit-to-stand, rather than reconnecting per exercise). Exposes `connect()`, `calibrate()`, `createBleSensorSource()` (implements the same `SensorSource` interface as the simulator, so the capture pages don't care which one they're using). Decodes the firmware's single-angle payload and hands the rest of the app the same `{thighAngle, shinAngle}` shape it already expected, with `thighAngle` fixed at 0.
- `src/pages/SensorPairingPage.tsx` — new step between the questionnaire and the exercise captures: Connect → Calibrate, matching the spec's workflow order. Skippable, same optional/graceful-fallback pattern as the camera — declining or having no sensor in range just falls back to the simulator with a clear on-screen note. Calibration instructions now specifically say to straighten the leg first (required for single-sensor mode's 0°-reference to be correct).

**What's verified vs. what needs real hardware:** the 8-byte angle payload's byte layout round-trips exactly (checked with a real `DataView`, matching what the ESP32's `memcpy` would produce). Live-tested the full pairing → fallback path: the connect button correctly reaches the real Web Bluetooth `requestDevice()` call (confirmed by the specific error it produces — a `SecurityError` about needing a genuine user gesture, which this automated test can't provide, not an API-missing or code error), and declining/failing to connect falls back to the simulator cleanly with no regression to the rest of the flow. The firmware itself and the live BLE data path can only be exercised with a real ESP32 + MPU6050, which this sandbox doesn't have — the C++ was written and reviewed carefully but not compiled; check the Serial Monitor output on first flash. Earlier bring-up reportedly used a generic BLE scanner app (nRF Connect / Serial Bluetooth Terminal) to confirm the ESP32 was broadcasting at all — that's a fine sanity check, but this app's own BLE stack (`bleConnection.ts`) is what actually needs to pair for the sensor data to reach the classification pipeline.

## Mobile layout audit

Tested at 375×812 (iPhone-ish) and down to ~320px width — no horizontal overflow anywhere, touch targets ≥44px throughout. Two real bugs found and fixed along the way:

1. **Buttons inside a 2-column CSS grid weren't stretching to fill their column** (e.g. the walk test's Step/Pause tap buttons rendered at 80px wide instead of ~180px). `<button>` doesn't reliably auto-stretch in a grid the way a `<div>` does — every grid-button spot now sets `width: '100%'` explicitly.
2. **`<main>` itself could collapse to its content's shrink-wrapped width** instead of filling the screen, specifically triggered by a descendant grid with `1fr` columns interacting with `#root`'s flex-stretch layout (`#root` is `display: flex; flex-direction: column` from the Vite template). Fixed by giving every page's `<main>` an explicit `width: '100%'` alongside its `maxWidth: 480`, rather than relying on flex-stretch defaults.

Also added `viewport-fit=cover` + `env(safe-area-inset-*)` padding on `#root` (and the questionnaire's sticky Save button) so the native app renders correctly under a notch / around the home-indicator area once wrapped in Capacitor — a plain browser can't surface this, but it matters for the real target platform.

## Not built yet

- **Flashing and field-testing the ESP32 firmware on real hardware** — this is the one piece that genuinely can't be finished without you: compile in Arduino IDE, flash, wire up per `firmware/README.md`, and confirm the LED sequence + a real BLE pairing from the app.
- Syncing the actual PDF bytes to cloud storage (only the `reports` row metadata syncs today — the file itself would need a Supabase Storage bucket).
- A live Supabase project to actually apply `supabase/schema.sql` + `supabase/rls.sql` against and test sign-in/sign-up end-to-end — the auth code is written and its offline/unconfigured paths are verified, but the real network round trip isn't.
- Real Manipuri translation content, audio instructions.

## Android build

The native Android project is scaffolded (`android/` — gitignored, since it's generated; recreate it with `npx cap add android` if the folder ever goes missing). It correctly picked up all 4 native plugins (`bluetooth-le`, `sqlite`, `filesystem`, `network`) into `capacitor.settings.gradle`, and `applicationId` matches `capacitor.config.ts` (`com.kneesense.ner`).

One manual fix was needed beyond the default scaffold: Capacitor's WebView doesn't grant camera access to plain `getUserMedia()` calls (which is what the MediaPipe cross-check uses) on its own. `MainActivity.java` now wires WebView permission requests through to Android's normal runtime-permission flow, and `AndroidManifest.xml` declares `CAMERA` as an optional feature (`android:required="false"`, since the camera cross-check is optional — the app should still install and run on a device without one). Bluetooth permissions needed no manual work; the `bluetooth-le` plugin's own manifest declares those and Gradle merges them in automatically.

**Not built or run in this session** — there's no JDK/Android SDK available here, so this is scaffolded and reviewed but not compiled. To actually build and run it:

```bash
npm run build && npx cap sync android
npx cap open android   # opens Android Studio
```

Then Run ▸ Run 'app' in Android Studio, targeting an emulator or a USB-connected device. This is also where you'd test the sensor-pairing (BLE) and camera cross-check screens for real, since both need real hardware this sandbox doesn't have.

## Next steps

- `npx cap add ios` if you also want an iOS build (needs a Mac + Xcode).
- Add the Supabase mirror schema + RLS policies (same table names/columns as `schema.sql`).
