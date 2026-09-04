import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { calibrate, connect, isConnected, onDisconnect } from '../lib/bleConnection'
import { useTranslation } from '../i18n/I18nContext'
import { Icon } from '../components/Icon'
import { ErrorModal } from '../components/ErrorModal'

type Status = 'idle' | 'connecting' | 'connected' | 'calibrating' | 'calibrated' | 'error'

export default function SensorPairingPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>(isConnected() ? 'connected' : 'idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lowPowerWarning, setLowPowerWarning] = useState(false)

  useEffect(() => onDisconnect(() => setStatus('idle')), [])

  async function onConnect() {
    setStatus('connecting')
    try {
      const { possibleLowPowerReset } = await connect()
      setStatus('connected')
      if (possibleLowPowerReset) setLowPowerWarning(true)
    } catch (err) {
      setErrorMessage(String(err))
      setStatus('error')
    }
  }

  async function onCalibrate() {
    setStatus('calibrating')
    try {
      await calibrate()
      setStatus('calibrated')
    } catch (err) {
      setErrorMessage(String(err))
      setStatus('error')
    }
  }

  return (
    <main className="page">
      <div className="page-header-row">
        <div className="page-icon-badge"><Icon name="bluetooth" size={22} /></div>
        <div className="page-header">
          <h1 className="page-title">{t('sensorPairing.title')}</h1>
          <p className="page-subtitle">{t('sensorPairing.subtitle')}</p>
        </div>
      </div>

      <p className="card-info">{t('sensorPairing.skipNotice')}</p>

      <div className="section">
        <h2 className="section-title">{t('sensorPairing.step1')}</h2>
        <button
          type="button"
          onClick={onConnect}
          disabled={status === 'connecting' || status === 'connected' || status === 'calibrating' || status === 'calibrated'}
          className="btn btn-primary btn-lg btn-block"
        >
          {status === 'connecting'
            ? t('sensorPairing.connecting')
            : status === 'idle' || status === 'error'
              ? t('sensorPairing.connect')
              : t('sensorPairing.connected')}
        </button>
      </div>

      <div className="section">
        <h2 className="section-title">{t('sensorPairing.step2')}</h2>
        <p className="page-subtitle">{t('sensorPairing.calibrateSubtitle')}</p>
        <button
          type="button"
          onClick={onCalibrate}
          disabled={status !== 'connected' && status !== 'calibrated'}
          className="btn btn-primary btn-lg btn-block"
        >
          {status === 'calibrating' ? t('sensorPairing.calibrating') : status === 'calibrated' ? t('sensorPairing.calibrated') : t('sensorPairing.calibrate')}
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate(`/session/${sessionId}/exercise`)}
        className="btn btn-secondary btn-lg btn-block"
      >
        {status === 'calibrated' ? t('sensorPairing.continue') : t('sensorPairing.skip')}
      </button>

      {errorMessage && (
        <ErrorModal
          title={t('sensorError.genericTitle')}
          message={errorMessage}
          primaryLabel={t('sensorError.dismiss')}
          onPrimary={() => setErrorMessage(null)}
        />
      )}

      {lowPowerWarning && (
        <ErrorModal
          variant="warning"
          title={t('sensorError.lowPowerWarningTitle')}
          message={t('sensorError.lowPowerWarningMessage')}
          primaryLabel={t('sensorError.dismiss')}
          onPrimary={() => setLowPowerWarning(false)}
        />
      )}
    </main>
  )
}
