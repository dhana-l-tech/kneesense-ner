import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { saveExerciseCapture } from '../db/repositories/exerciseCaptures'
import { saveCameraFeatures } from '../db/repositories/cameraFeatures'
import { getSession } from '../db/repositories/sessions'
import { SimulatedKneeExtensionSource, type SensorSource } from '../lib/sensorSource'
import { createBleSensorSource, isConnected as isSensorConnected, onDisconnect } from '../lib/bleConnection'
import { PoseCameraSource, type CameraAngleSample, type KneeSide, type Point2D } from '../lib/cameraSource'
import { useTranslation } from '../i18n/I18nContext'
import { Icon } from '../components/Icon'
import { ErrorModal } from '../components/ErrorModal'
import type { AngleSample } from '../lib/motionAnalysis'
import type { CameraFeatures, ExerciseCapture } from '../types/models'

const CONFIDENCE_COLORS = { high: '#4f8f3f', medium: '#b6842a', low: '#c6553d' }

function confidenceColor(confidence: number): string {
  if (confidence >= 0.7) return CONFIDENCE_COLORS.high
  if (confidence >= 0.4) return CONFIDENCE_COLORS.medium
  return CONFIDENCE_COLORS.low
}

function drawSkeleton(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  points: { hip: Point2D; knee: Point2D; ankle: Point2D },
  angle: number,
  confidence: number,
) {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const toPx = (p: Point2D) => ({ x: p.x * w, y: p.y * h })
  const hip = toPx(points.hip)
  const knee = toPx(points.knee)
  const ankle = toPx(points.ankle)
  const color = confidenceColor(confidence)

  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(3, w * 0.006)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(hip.x, hip.y)
  ctx.lineTo(knee.x, knee.y)
  ctx.lineTo(ankle.x, ankle.y)
  ctx.stroke()

  for (const p of [hip, knee, ankle]) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(5, w * 0.009), 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }

  const label = `${Math.round(angle)}°`
  const fontSize = Math.max(20, Math.round(w * 0.035))
  ctx.font = `700 ${fontSize}px Quicksand, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const metrics = ctx.measureText(label)
  const padX = 10
  const padY = 6
  const boxX = knee.x + 16
  const boxY = knee.y - fontSize / 2 - padY
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(boxX - padX, boxY, metrics.width + padX * 2, fontSize + padY * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, boxX, boxY + fontSize / 2 + padY)
}

export default function ExerciseCapturePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [capturing, setCapturing] = useState(false)
  const [sampleCount, setSampleCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ExerciseCapture | null>(null)
  const [cameraFeatures, setCameraFeatures] = useState<CameraFeatures | null>(null)

  const [useCamera, setUseCamera] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [liveAngle, setLiveAngle] = useState<number | null>(null)
  const [liveConfidence, setLiveConfidence] = useState<number | null>(null)
  const [sensorErrorModal, setSensorErrorModal] = useState<{ title: string; message: string } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const sourceRef = useRef<SensorSource | null>(null)
  const samplesRef = useRef<AngleSample[]>([])
  const startTimeRef = useRef<string>('')
  const dataSourceRef = useRef<'ble' | 'simulated'>('simulated')

  const cameraSourceRef = useRef<PoseCameraSource | null>(null)
  const cameraSamplesRef = useRef<CameraAngleSample[]>([])

  // Mid-capture disconnect (dead battery, out of range, etc.) — sourceRef is
  // only non-null while a capture is actually in progress, so this only
  // fires when it matters, not on every disconnect anywhere in the app.
  useEffect(
    () =>
      onDisconnect(() => {
        if (!sourceRef.current) return
        handleSensorError(t('sensorError.disconnectedMidCaptureMessage'))
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  function handleSensorError(message: string) {
    sourceRef.current?.stop()
    sourceRef.current = null
    samplesRef.current = []
    setSampleCount(0)
    setCapturing(false)
    setSensorErrorModal({ title: t('sensorError.genericTitle'), message })
  }

  function onStart() {
    const sensorConnected = isSensorConnected()

    samplesRef.current = []
    setSampleCount(0)
    setResult(null)
    setCameraFeatures(null)
    setCameraError(null)
    setLiveAngle(null)
    setLiveConfidence(null)
    startTimeRef.current = new Date().toISOString()

    const source = sensorConnected ? createBleSensorSource() : new SimulatedKneeExtensionSource()
    sourceRef.current = source
    dataSourceRef.current = sensorConnected ? 'ble' : 'simulated'
    source.start(
      (sample) => {
        samplesRef.current.push(sample)
        setSampleCount(samplesRef.current.length)
      },
      () => handleSensorError(t('sensorError.startFailedMessage')),
    )

    if (useCamera && videoRef.current) {
      cameraSamplesRef.current = []
      const cameraSource = new PoseCameraSource()
      cameraSourceRef.current = cameraSource
      getSession(sessionId!)
        .then((session) => {
          const side: KneeSide = session?.affected_knee === 'right' ? 'right' : 'left'
          return cameraSource.start(videoRef.current!, side, (sample: CameraAngleSample) => {
            cameraSamplesRef.current.push(sample)
            setLiveAngle(sample.kneeAngle)
            setLiveConfidence(sample.confidence)
            if (sample.imagePoints && videoRef.current && canvasRef.current) {
              drawSkeleton(canvasRef.current, videoRef.current, sample.imagePoints, sample.kneeAngle, sample.confidence)
            }
          })
        })
        .catch((err) => setCameraError(String(err)))
    }

    setCapturing(true)
  }

  async function onStop() {
    sourceRef.current?.stop()
    sourceRef.current = null
    cameraSourceRef.current?.stop()
    cameraSourceRef.current = null
    setCapturing(false)
    setLiveAngle(null)
    setLiveConfidence(null)
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

    if (!sessionId || samplesRef.current.length === 0) return
    setSaving(true)
    try {
      const capture = await saveExerciseCapture({
        sessionId,
        exerciseType: 'knee_extension',
        startTime: startTimeRef.current,
        endTime: new Date().toISOString(),
        samples: samplesRef.current,
        dataSource: dataSourceRef.current,
      })
      setResult(capture)

      if (useCamera && cameraSamplesRef.current.length > 0 && capture.rom_deg !== undefined) {
        const camFeatures = await saveCameraFeatures({
          exerciseCaptureId: capture.id,
          imuRomDeg: capture.rom_deg,
          cameraSamples: cameraSamplesRef.current,
        })
        setCameraFeatures(camFeatures)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="page">
      <div className="page-header-row">
        <div className="page-icon-badge"><Icon name="activity" size={22} /></div>
        <div className="page-header">
          <h1 className="page-title">{t('kneeExtension.title')}</h1>
          <p className="page-subtitle">{t('kneeExtension.subtitle')}</p>
        </div>
      </div>

      <p className="card-info">
        {isSensorConnected() ? t('kneeExtension.sensorConnected') : t('kneeExtension.sensorSimulated')}
      </p>

      {!capturing && !result && (
        <div className="section">
          <button
            type="button"
            onClick={() => setUseCamera((v) => !v)}
            className={`choice-btn${useCamera ? ' is-selected' : ''}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="camera" size={18} />
            {useCamera ? t('kneeExtension.cameraEnabled') : t('kneeExtension.enableCamera')}
          </button>
          <button type="button" onClick={onStart} className="btn btn-primary btn-lg btn-block">
            {t('kneeExtension.startCapture')}
          </button>
        </div>
      )}

      {useCamera && (
        <div style={{ position: 'relative', display: capturing ? 'block' : 'none' }}>
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: '100%', display: 'block', borderRadius: 'var(--radius-md)', background: '#000' }}
          />
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />
          {liveAngle !== null && (
            <div
              className="card-info"
              style={{
                position: 'absolute',
                left: 8,
                bottom: 8,
                right: 8,
                margin: 0,
                background: 'rgba(0, 0, 0, 0.55)',
                color: '#fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
                {Math.round(liveAngle)}°
              </span>
              <span style={{ fontSize: 12, color: confidenceColor(liveConfidence ?? 0) }}>
                {t('kneeExtension.cameraConfidence')}: {Math.round((liveConfidence ?? 0) * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {cameraError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{t('kneeExtension.cameraError', { message: cameraError })}</p>}

      {capturing && (
        <div className="section">
          <p className="page-subtitle">{t('kneeExtension.capturing', { count: sampleCount })}</p>
          <button type="button" onClick={onStop} className="btn btn-danger btn-lg btn-block">
            {t('kneeExtension.stopCapture')}
          </button>
        </div>
      )}

      {saving && <p className="page-subtitle">{t('kneeExtension.analyzing')}</p>}

      {result && (
        <div className="section">
          <h2 className="section-title">{t('kneeExtension.result')}</h2>
          <table className="data-table">
            <tbody>
              <tr><td>{t('kneeExtension.minAngle')}</td><td>{result.min_angle_deg}°</td></tr>
              <tr><td>{t('kneeExtension.maxAngle')}</td><td>{result.max_angle_deg}°</td></tr>
              <tr><td>{t('kneeExtension.rangeOfMotion')}</td><td>{result.rom_deg}°</td></tr>
              <tr><td>{t('kneeExtension.smoothness')}</td><td>{result.smoothness}</td></tr>
              <tr><td>{t('kneeExtension.repsCounted')}</td><td>{result.rep_count}</td></tr>
            </tbody>
          </table>

          {cameraFeatures && (
            <>
              <h2 className="section-title">{t('kneeExtension.cameraCrossCheck')}</h2>
              <table className="data-table">
                <tbody>
                  <tr><td>{t('kneeExtension.cameraRom')}</td><td>{cameraFeatures.camera_rom}°</td></tr>
                  <tr><td>{t('kneeExtension.imuCameraDiff')}</td><td>{cameraFeatures.imu_camera_diff}°</td></tr>
                  <tr><td>{t('kneeExtension.cameraConfidence')}</td><td>{cameraFeatures.confidence_avg}</td></tr>
                </tbody>
              </table>
              {cameraFeatures.agreement_status === 'mismatch' && (
                <p className="card-muted" style={{ background: 'var(--color-danger-tint)', color: 'var(--color-danger)' }}>
                  {t('kneeExtension.mismatchWarning')}
                </p>
              )}
              {cameraFeatures.agreement_status === 'check_filtering' && (
                <p className="card-muted" style={{ background: 'var(--color-warning-tint)', color: 'var(--color-warning)' }}>
                  {t('kneeExtension.checkFilteringWarning')}
                </p>
              )}
              {(cameraFeatures.confidence_avg ?? 0) < 0.5 && (
                <p className="card-muted">{t('kneeExtension.lowConfidenceNotice')}</p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => navigate(`/session/${sessionId}/sit-to-stand`)}
            className="btn btn-primary btn-lg btn-block"
          >
            {t('kneeExtension.continueToSitToStand')}
          </button>
        </div>
      )}

      {sensorErrorModal && (
        <ErrorModal
          title={sensorErrorModal.title}
          message={sensorErrorModal.message}
          primaryLabel={t('sensorError.goToPairing')}
          onPrimary={() => navigate(`/session/${sessionId}/sensor-pairing`)}
          secondaryLabel={t('sensorError.dismiss')}
          onSecondary={() => setSensorErrorModal(null)}
        />
      )}
    </main>
  )
}
