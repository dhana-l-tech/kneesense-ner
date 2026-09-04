// Canonical English strings — the source of truth for every translation key.
// Other locale files (as.ts, bn.ts, hi.ts, ta.ts) are typed against this file's
// key set, so a missing translation is a compile error, not a silent
// English fallback slipping through unnoticed.
export const en = {
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.back': 'Back',
  'common.none': 'None',
  'common.mild': 'Mild',
  'common.moderate': 'Moderate',
  'common.severe': 'Severe',

  'app.title': 'KneeSense NER',

  // ---------------- Patients ----------------
  'patients.subtitleSynced': 'All records synced',
  'patients.subtitlePending': '{count} record(s) waiting to sync',
  'patients.patientId': 'Patient ID',
  'patients.patientIdPlaceholder': 'e.g. NER-2026-0001',
  'patients.ageGroup': 'Age group',
  'patients.location': 'Location (village/district)',
  'patients.saving': 'Saving…',
  'patients.registerButton': 'Register patient',
  'patients.registeredPatients': 'Registered patients ({count})',
  'patients.synced': 'Synced',
  'patients.pendingSync': 'Pending sync',
  'patients.startScreening': 'Start screening',

  // ---------------- New session ----------------
  'newSession.title': 'New screening',
  'newSession.whichKnee': 'Which knee is affected?',
  'newSession.leftKnee': 'Left knee',
  'newSession.rightKnee': 'Right knee',
  'newSession.bothKnees': 'Both knees',
  'newSession.previousInjury': 'Any previous knee injury?',
  'newSession.starting': 'Starting…',
  'newSession.continueToQuestionnaire': 'Continue to questionnaire',

  // ---------------- Questionnaire ----------------
  'questionnaire.savedTitle': 'Questionnaire saved',
  'questionnaire.savedSubtitle': 'Next: attach the sensor and calibrate.',
  'questionnaire.continueToSensorSetup': 'Continue to sensor setup',
  'questionnaire.title': 'Symptom questionnaire',
  'questionnaire.painSectionLabel': 'Pain score — 0 = no pain, 10 = worst pain',
  'questionnaire.painAtRest': 'Pain at rest',
  'questionnaire.painWhileWalking': 'Pain while walking',
  'questionnaire.painWhileBending': 'Pain while bending the knee',
  'questionnaire.painWhileClimbingStairs': 'Pain while climbing stairs',
  'questionnaire.otherSymptomsLabel': 'Other symptoms',
  'questionnaire.morningStiffness': 'Morning stiffness',
  'questionnaire.swelling': 'Swelling',
  'questionnaire.walkingDifficulty': 'Walking difficulty',
  'questionnaire.stairClimbingDifficulty': 'Stair-climbing difficulty',
  'questionnaire.standFromChairDifficulty': 'Difficulty standing from a chair',
  'questionnaire.saving': 'Saving…',
  'questionnaire.saveButton': 'Save questionnaire',

  // ---------------- Sensor pairing ----------------
  'sensorPairing.title': 'Attach & calibrate sensors',
  'sensorPairing.subtitle':
    'Attach the sensor to the outer shin, 8–12 cm below the knee, pointing toward the hip.',
  'sensorPairing.skipNotice':
    'No ESP32 in range? You can skip this step, but the exercise screens will ask you to connect a sensor before they let you start a capture — there is no simulated fallback.',
  'sensorPairing.step1': '1. Connect',
  'sensorPairing.connect': 'Connect to ESP32',
  'sensorPairing.connecting': 'Connecting…',
  'sensorPairing.connected': '✓ Connected',
  'sensorPairing.step2': '2. Calibrate',
  'sensorPairing.calibrateSubtitle': 'Have the patient straighten their leg fully and hold still, then calibrate.',
  'sensorPairing.calibrate': 'Calibrate',
  'sensorPairing.calibrating': 'Calibrating…',
  'sensorPairing.calibrated': '✓ Calibrated',
  'sensorPairing.continue': 'Continue',
  'sensorPairing.skip': 'Skip for now',

  // ---------------- Sensor errors (ErrorModal.tsx) ----------------
  'sensorError.genericTitle': 'Sensor error',
  'sensorError.notConnectedTitle': 'No sensor connected',
  'sensorError.notConnectedMessage':
    'Connect and calibrate the ESP32 on the Sensor Pairing screen before starting a capture. There is no simulated fallback — a capture cannot start without a real sensor connected.',
  'sensorError.disconnectedMidCaptureMessage':
    'The sensor disconnected during capture (check battery and range). The partial data was discarded — reconnect and redo the capture.',
  'sensorError.startFailedMessage':
    'Could not start streaming from the sensor. Check that it is powered on and in range, then try again.',
  'sensorError.goToPairing': 'Go to Sensor Pairing',
  'sensorError.dismiss': 'Dismiss',
  'sensorError.lowPowerWarningTitle': 'Possible low-power reset',
  'sensorError.lowPowerWarningMessage':
    "The sensor's last run was interrupted by a brownout reset (input power sagged too low) — likely the power bank getting low. Check the power bank before starting a screening.",

  // ---------------- Knee extension capture ----------------
  'kneeExtension.title': 'Seated knee extension',
  'kneeExtension.subtitle':
    'Have the patient sit with the sensor attached, then extend and bend the knee at a steady pace for 6–8 repetitions.',
  'kneeExtension.sensorConnected': '✓ ESP32 connected — using live sensor data.',
  'kneeExtension.sensorNotConnected': 'No ESP32 connected. Go to Sensor Pairing before starting a capture.',
  'kneeExtension.enableCamera': 'Enable camera cross-check (optional)',
  'kneeExtension.cameraEnabled': '✓ Camera cross-check enabled',
  'kneeExtension.startCapture': 'Start capture',
  'kneeExtension.capturing': 'Capturing… {count} samples',
  'kneeExtension.stopCapture': 'Stop capture',
  'kneeExtension.cameraError': 'Camera error: {message}',
  'kneeExtension.analyzing': 'Analyzing…',
  'kneeExtension.result': 'Result',
  'kneeExtension.minAngle': 'Min angle',
  'kneeExtension.maxAngle': 'Max angle',
  'kneeExtension.rangeOfMotion': 'Range of motion',
  'kneeExtension.smoothness': 'Smoothness (lower = smoother)',
  'kneeExtension.repsCounted': 'Repetitions counted',
  'kneeExtension.cameraCrossCheck': 'Camera cross-check',
  'kneeExtension.cameraRom': 'Camera ROM',
  'kneeExtension.imuCameraDiff': 'IMU-camera difference',
  'kneeExtension.cameraConfidence': 'Camera confidence',
  'kneeExtension.mismatchWarning':
    'IMU and camera disagree by more than 10°. Check sensor placement and recalibrate before trusting this result.',
  'kneeExtension.checkFilteringWarning': 'IMU and camera differ by 6–10°. Consider checking sensor placement.',
  'kneeExtension.lowConfidenceNotice': 'Camera confidence is low — relying on the IMU reading instead.',
  'kneeExtension.continueToSitToStand': 'Continue to sit-to-stand test',

  // ---------------- Sit-to-stand ----------------
  'sitToStand.title': 'Sit-to-stand test',
  'sitToStand.safetyIntro':
    'The patient will stand up fully and sit back down repeatedly for about 5 repetitions. Only perform this if it is safe — skip it for patients with a fall risk, severe pain, or who need more support than a stable chair.',
  'sitToStand.safetyQuestion': 'Is it safe to perform this test without assistance risk?',
  'sitToStand.proceed': 'Yes, proceed',
  'sitToStand.skipTest': 'No, skip test',
  'sitToStand.skippedTitle': 'Sit-to-stand test skipped',
  'sitToStand.skippedSubtitle': "Marked as skipped for patient safety. This won't count against the screening result.",
  'sitToStand.readySubtitle':
    'Have the patient sit in a stable chair with the sensor attached, arms crossed if possible, then stand fully and sit back down at a steady pace for about 5 repetitions.',
  'sitToStand.capturingTitle': 'Capturing…',
  'sitToStand.samplesCount': '{count} samples',
  'sitToStand.resultTitle': 'Result',
  'sitToStand.repsTarget': '{count} (target ~5)',
  'sitToStand.continueToWalkTest': 'Continue to walking test',

  // ---------------- Walk test ----------------
  'walkTest.title': 'Walking test',
  'walkTest.setupSubtitle': 'Choose the walking distance, then start the patient walking at their normal pace.',
  'walkTest.distance6m': '3 m there & back (6 m)',
  'walkTest.distance10m': '10 m corridor',
  'walkTest.startWalk': 'Start walk',
  'walkTest.walkingTitle': 'Walking…',
  'walkTest.step': 'Step',
  'walkTest.pause': 'Pause',
  'walkTest.stopWalk': 'Stop walk',
  'walkTest.finishTitle': 'Walking test — finish up',
  'walkTest.finishSubtitle': 'Time {time}s · {steps} steps · {pauses} pause(s)',
  'walkTest.assistanceQuestion': 'Did the patient need assistance (person, cane, wall)?',
  'walkTest.gaitIrregularity': 'Gait irregularity (limping, unevenness)',
  'walkTest.saving': 'Saving…',
  'walkTest.saveButton': 'Save walk test',
  'walkTest.savedTitle': 'Walk test saved',
  'walkTest.distanceLabel': 'Distance',
  'walkTest.timeLabel': 'Time',
  'walkTest.stepsLabel': 'Steps',
  'walkTest.speedLabel': 'Speed',
  'walkTest.cadenceLabel': 'Cadence',
  'walkTest.pausesLabel': 'Pauses',
  'walkTest.continueToResults': 'Continue to results',

  // ---------------- Results ----------------
  'results.calculating': 'Calculating…',
  'results.errorTitle': 'Could not compute results',
  'results.simulatedDataTitle': 'Sensor not connected during capture',
  'results.simulatedDataMessage':
    'The knee-extension capture used a simulated test signal, not real sensor readings — no ESP32 was connected at the time. A risk result cannot be shown for simulated data. Reconnect the sensor on the pairing screen and redo the knee-extension capture.',
  'results.recaptureButton': 'Redo knee-extension capture',
  'results.lowHeading': 'Low OA-risk markers',
  'results.lowGuidance': 'No urgent concerns identified. Advise routine monitoring and preventive knee care.',
  'results.moderateHeading': 'Moderate OA-risk markers detected',
  'results.moderateGuidance':
    'Some risk markers present. Provide preventive guidance and recommend follow-up if symptoms persist or worsen.',
  'results.highHeading': 'High OA-risk markers detected',
  'results.highGuidance': 'Multiple risk markers present. Further clinical evaluation recommended.',
  'results.scoreBreakdown': 'Score breakdown',
  'results.symptomsComponent': 'Symptoms (pain, stiffness, swelling)',
  'results.romComponent': 'Range of motion',
  'results.movementQualityComponent': 'Movement quality (smoothness)',
  'results.mobilityComponent': 'Walking / mobility difficulty',
  'results.agreementComponent': 'Sensor-camera agreement',
  'results.overall': 'Overall',
  'results.disclaimer':
    'This is an automated screening result based on self-reported symptoms and movement-sensor readings. It identifies possible OA risk markers only and is not a medical diagnosis. A qualified clinician should review this result before any clinical decision is made.',
  'results.generatingReport': 'Generating report…',
  'results.downloadReport': 'Download PDF report',
  'results.reportSaved': 'Report saved: {path}',
  'results.reportError': 'Could not generate report: {message}',
  'results.backToPatients': 'Back to patients',
} as const;

export type MessageKey = keyof typeof en;
