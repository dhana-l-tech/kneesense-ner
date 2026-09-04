import { Icon } from './Icon'

interface ErrorModalProps {
  title: string
  message: string
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  /** 'danger' (default) for a real failure; 'warning' for an advisory notice (e.g. a possible low-power reset) that doesn't block anything. */
  variant?: 'danger' | 'warning'
}

/** Blocking popup for sensor/BLE errors — used instead of silently falling back to fake data (see sensorSource.ts). */
export function ErrorModal({
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  variant = 'danger',
}: ErrorModalProps) {
  return (
    <div className="modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-card">
        <div className={`modal-icon-badge modal-icon-badge-${variant}`}>
          <Icon name="alert-triangle" size={26} />
        </div>
        <h2 id="modal-title" className="modal-title">{title}</h2>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onPrimary} className="btn btn-primary btn-lg btn-block">
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button type="button" onClick={onSecondary} className="btn btn-secondary btn-lg btn-block">
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
