import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { computeAndSaveRiskScore } from '../db/repositories/riskScores'
import { generateReport } from '../db/repositories/reports'
import { useTranslation } from '../i18n/I18nContext'
import { Icon, type IconName } from '../components/Icon'
import type { MessageKey } from '../i18n/translations/en'
import type { RiskScoreBreakdown } from '../lib/riskScoring'
import type { RiskCategory } from '../types/models'

const CATEGORY_KEYS: Record<RiskCategory, { heading: MessageKey; guidance: MessageKey; icon: IconName; iconColor: string }> = {
  low: { heading: 'results.lowHeading', guidance: 'results.lowGuidance', icon: 'check-circle', iconColor: 'var(--color-success)' },
  moderate: { heading: 'results.moderateHeading', guidance: 'results.moderateGuidance', icon: 'alert-triangle', iconColor: 'var(--color-warning)' },
  high: { heading: 'results.highHeading', guidance: 'results.highGuidance', icon: 'alert-octagon', iconColor: 'var(--color-danger)' },
}

const COMPONENT_KEYS: { key: keyof RiskScoreBreakdown; label: MessageKey; weight: string }[] = [
  { key: 'symptomScore', label: 'results.symptomsComponent', weight: '30%' },
  { key: 'romScore', label: 'results.romComponent', weight: '25%' },
  { key: 'movementQualityScore', label: 'results.movementQualityComponent', weight: '15%' },
  { key: 'mobilityScore', label: 'results.mobilityComponent', weight: '20%' },
  { key: 'agreementScore', label: 'results.agreementComponent', weight: '10%' },
]

export default function ResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [breakdown, setBreakdown] = useState<RiskScoreBreakdown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reportStatus, setReportStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [reportInfo, setReportInfo] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    computeAndSaveRiskScore(sessionId)
      .then((row) => setBreakdown(row.breakdown))
      .catch((err) => setError(String(err)))
  }, [sessionId])

  if (error) {
    return (
      <main className="page">
        <div className="page-header">
          <h1 className="page-title">{t('results.errorTitle')}</h1>
          <p style={{ color: 'var(--color-danger)' }}>{error}</p>
        </div>
      </main>
    )
  }

  if (!breakdown) {
    return (
      <main className="page">
        <p className="page-subtitle">{t('results.calculating')}</p>
      </main>
    )
  }

  const copy = CATEGORY_KEYS[breakdown.riskCategory]

  async function onGenerateReport() {
    if (!sessionId) return
    setReportStatus('generating')
    try {
      const { savedTo } = await generateReport(sessionId)
      setReportInfo(savedTo)
      setReportStatus('done')
    } catch (err) {
      setReportInfo(String(err))
      setReportStatus('error')
    }
  }

  return (
    <main className="page">
      <div className={`risk-banner risk-banner-${breakdown.riskCategory}`}>
        <div className="risk-icon-badge" style={{ color: copy.iconColor }}>
          <Icon name={copy.icon} size={28} />
        </div>
        <span className="risk-heading">{t(copy.heading)}</span>
        <span className="risk-guidance">{t(copy.guidance)}</span>
      </div>

      <div className="section">
        <div className="section-label">{t('results.scoreBreakdown')}</div>
        <table className="data-table">
          <tbody>
            {COMPONENT_KEYS.map(({ key, label, weight }) => (
              <tr key={key}>
                <td>{t(label)} <span style={{ color: 'var(--color-ink-faint)' }}>({weight})</span></td>
                <td>{Math.round((breakdown[key] as number) * 100)}%</td>
              </tr>
            ))}
            <tr className="total">
              <td>{t('results.overall')}</td>
              <td>{Math.round(breakdown.weightedTotal * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="card-muted">{t('results.disclaimer')}</p>

      <div className="section">
        <button
          type="button"
          onClick={onGenerateReport}
          disabled={reportStatus === 'generating'}
          className="btn btn-primary btn-lg btn-block"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Icon name="file-text" size={18} />
          {reportStatus === 'generating' ? t('results.generatingReport') : t('results.downloadReport')}
        </button>
        {reportStatus === 'done' && (
          <p style={{ color: 'var(--color-success)', fontSize: 13 }}>{t('results.reportSaved', { path: reportInfo ?? '' })}</p>
        )}
        {reportStatus === 'error' && (
          <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{t('results.reportError', { message: reportInfo ?? '' })}</p>
        )}
      </div>

      <button type="button" onClick={() => navigate('/')} className="btn btn-secondary btn-lg btn-block">
        {t('results.backToPatients')}
      </button>
    </main>
  )
}
