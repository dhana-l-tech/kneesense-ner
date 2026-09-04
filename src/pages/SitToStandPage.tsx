import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { saveExerciseCapture } from '../db/repositories/exerciseCaptures'
import { createBleSensorSource, isConnected as isSensorConnected } from '../lib/bleConnection'
import { SimulatedSitToStandSource, type SensorSource } from '../lib/sensorSource'
import { useTranslation } from '../i18n/I18nContext'
import { Icon } from '../components/Icon'
import type { AngleSample } from '../lib/motionAnalysis'
import type { ExerciseCapture } from '../types/models'

type Phase = 'safety-check' | 'ready' | 'capturing' | 'saving' | 'done' | 'skipped'

export default function SitToStandPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [phase, setPhase] = useState<Phase>('safety-check')
  const [sampleCount, setSampleCount] = useState(0)
  const [result, setResult] = useState<ExerciseCapture | null>(null)

  const sourceRef = useRef<SensorSource | null>(null)
  const samplesRef = useRef<AngleSample[]>([])
  const startTimeRef = useRef<string>('')
  const dataSourceRef = useRef<'ble' | 'simulated'>('simulated')

  function onStart() {
    samplesRef.current = []
    setSampleCount(0)
    setResult(null)
    startTimeRef.current = new Date().toISOString()

    const sensorConnected = isSensorConnected()
    const source = sensorConnected ? createBleSensorSource() : new SimulatedSitToStandSource()
    sourceRef.current = source
    dataSourceRef.current = sensorConnected ? 'ble' : 'simulated'
    source.start((sample) => {
      samplesRef.current.push(sample)
      setSampleCount(samplesRef.current.length)
    })
    setPhase('capturing')
  }

  async function onStop() {
    sourceRef.current?.stop()
    sourceRef.current = null

    if (!sessionId || samplesRef.current.length === 0) {
      setPhase('ready')
      return
    }
    setPhase('saving')
    const capture = await saveExerciseCapture({
      sessionId,
      exerciseType: 'sit_to_stand',
      startTime: startTimeRef.current,
      endTime: new Date().toISOString(),
      samples: samplesRef.current,
      dataSource: dataSourceRef.current,
    })
    setResult(capture)
    setPhase('done')
  }

  function goNext() {
    navigate(`/session/${sessionId}/walk-test`)
  }

  const wrap = (children: React.ReactNode) => <main className="page">{children}</main>

  if (phase === 'safety-check') {
    return wrap(
      <>
        <div className="page-header-row">
          <div className="page-icon-badge"><Icon name="chair" size={22} /></div>
          <div className="page-header">
            <h1 className="page-title">{t('sitToStand.title')}</h1>
            <p className="page-subtitle">{t('sitToStand.safetyIntro')}</p>
          </div>
        </div>
        <div className="section">
          <h2 className="section-title">{t('sitToStand.safetyQuestion')}</h2>
          <div className="choice-grid cols-2">
            <button type="button" className="choice-btn" onClick={() => setPhase('ready')}>
              {t('sitToStand.proceed')}
            </button>
            <button type="button" className="choice-btn" onClick={() => setPhase('skipped')}>
              {t('sitToStand.skipTest')}
            </button>
          </div>
        </div>
      </>,
    )
  }

  if (phase === 'skipped') {
    return wrap(
      <>
        <div className="page-header">
          <h1 className="page-title">{t('sitToStand.skippedTitle')}</h1>
          <p className="page-subtitle">{t('sitToStand.skippedSubtitle')}</p>
        </div>
        <button type="button" onClick={goNext} className="btn btn-primary btn-lg btn-block">
          {t('sitToStand.continueToWalkTest')}
        </button>
      </>,
    )
  }

  if (phase === 'ready') {
    return wrap(
      <>
        <div className="page-header-row">
          <div className="page-icon-badge"><Icon name="chair" size={22} /></div>
          <div className="page-header">
            <h1 className="page-title">{t('sitToStand.title')}</h1>
            <p className="page-subtitle">{t('sitToStand.readySubtitle')}</p>
          </div>
        </div>
        <p className="card-info">
          {isSensorConnected() ? t('kneeExtension.sensorConnected') : t('kneeExtension.sensorSimulated')}
        </p>
        <button type="button" onClick={onStart} className="btn btn-primary btn-lg btn-block">
          {t('kneeExtension.startCapture')}
        </button>
      </>,
    )
  }

  if (phase === 'capturing') {
    return wrap(
      <>
        <div className="page-header">
          <h1 className="page-title">{t('sitToStand.capturingTitle')}</h1>
          <p className="page-subtitle">{t('sitToStand.samplesCount', { count: sampleCount })}</p>
        </div>
        <button type="button" onClick={onStop} className="btn btn-danger btn-lg btn-block">
          {t('kneeExtension.stopCapture')}
        </button>
      </>,
    )
  }

  if (phase === 'saving') {
    return wrap(<p className="page-subtitle">{t('kneeExtension.analyzing')}</p>)
  }

  // done
  return wrap(
    <>
      <div className="page-header-row">
        <div className="page-icon-badge" style={{ background: 'var(--color-success-tint)', color: 'var(--color-success)' }}>
          <Icon name="check-circle" size={22} />
        </div>
        <div className="page-header">
          <h1 className="page-title">{t('sitToStand.resultTitle')}</h1>
        </div>
      </div>
      {result && (
        <table className="data-table">
          <tbody>
            <tr><td>{t('kneeExtension.minAngle')}</td><td>{result.min_angle_deg}°</td></tr>
            <tr><td>{t('kneeExtension.maxAngle')}</td><td>{result.max_angle_deg}°</td></tr>
            <tr><td>{t('kneeExtension.rangeOfMotion')}</td><td>{result.rom_deg}°</td></tr>
            <tr><td>{t('kneeExtension.smoothness')}</td><td>{result.smoothness}</td></tr>
            <tr><td>{t('kneeExtension.repsCounted')}</td><td>{t('sitToStand.repsTarget', { count: result.rep_count ?? 0 })}</td></tr>
          </tbody>
        </table>
      )}
      <button type="button" onClick={goNext} className="btn btn-primary btn-lg btn-block">
        {t('sitToStand.continueToWalkTest')}
      </button>
    </>,
  )
}
