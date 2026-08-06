import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppError } from '@shared/domain'
import { useAppStore } from '@/store/appStore'

interface ErrorBannerProps {
  error: AppError
  onRetry?: () => void
}

/**
 * Translates an AppError code into a user-facing message. For an expired
 * Claude CLI session it additionally offers to launch the login flow.
 */
export function ErrorBanner({ error, onRetry }: ErrorBannerProps): JSX.Element {
  const { t } = useTranslation()
  const backend = useAppStore((s) => s.config.llm.backend)
  const [loginStarted, setLoginStarted] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const errorId = useId()

  const showClaudeLogin = error.code === 'LLM_AUTH_EXPIRED' && backend === 'claude-cli'
  const technicalDetails = error.details ?? error.message
  const canShowDetails =
    (error.code === 'LLM_BAD_RESPONSE' || error.code === 'LLM_FAILED') && Boolean(technicalDetails)
  const detailsId = `error-details-${errorId}`

  const startLogin = async (): Promise<void> => {
    const result = await window.api.llm.startClaudeLogin()
    if (result.ok) setLoginStarted(true)
  }

  return (
    <div className="banner banner-error" role="alert">
      <div className="error-banner-main">
        <span style={{ flex: 1 }}>
          {t(`errors.${error.code}`)}
          {loginStarted && ` ${t('errors.claudeLoginStarted')}`}
        </span>
        {canShowDetails && (
          <button
            className="btn btn-sm btn-ghost"
            aria-expanded={showDetails}
            aria-controls={detailsId}
            onClick={() => setShowDetails((visible) => !visible)}
          >
            {t(showDetails ? 'errors.hideDetails' : 'errors.showDetails')}
          </button>
        )}
        {showClaudeLogin && !loginStarted && (
          <button className="btn btn-sm" onClick={startLogin}>
            {t('errors.claudeLogin')}
          </button>
        )}
        {onRetry && (
          <button className="btn btn-sm" onClick={onRetry}>
            {t('app.retry')}
          </button>
        )}
      </div>
      {canShowDetails && showDetails && (
        <div id={detailsId} className="error-banner-details">
          <span>{t('errors.technicalDetails')}</span>
          <pre>{technicalDetails}</pre>
        </div>
      )}
    </div>
  )
}
