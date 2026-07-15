import { useTranslation } from 'react-i18next'

interface BrowserMockProps {
  /** Address-bar text, e.g. the host the user should be on. */
  address: string
  /** Page heading drawn inside the mock. */
  pageTitle: string
  /** Label of the highlighted call-to-action button. */
  button: string
}

/**
 * A small, theme-aware schematic of the page where the token is generated -
 * a stand-in illustration (not a real screenshot) so it stays correct in every
 * theme and needs no bundled image. Colors come from CSS variables.
 */
function BrowserMock({ address, pageTitle, button }: BrowserMockProps): JSX.Element {
  return (
    <svg
      className="token-help-svg"
      viewBox="0 0 280 132"
      role="img"
      aria-label={pageTitle}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Window */}
      <rect x="1" y="1" width="278" height="130" rx="8" fill="var(--color-bg)" stroke="var(--color-border)" />
      {/* Title bar */}
      <path
        d="M1 9a8 8 0 0 1 8-8h262a8 8 0 0 1 8 8v18H1z"
        fill="var(--color-bg-raised)"
        stroke="var(--color-border)"
      />
      <circle cx="16" cy="14" r="3.5" fill="var(--color-text-muted)" opacity="0.5" />
      <circle cx="27" cy="14" r="3.5" fill="var(--color-text-muted)" opacity="0.5" />
      <circle cx="38" cy="14" r="3.5" fill="var(--color-text-muted)" opacity="0.5" />
      <rect x="52" y="7" width="212" height="15" rx="7.5" fill="var(--color-bg)" stroke="var(--color-border)" />
      <text x="62" y="17.5" fontSize="8.5" fill="var(--color-text-muted)">
        {address}
      </text>
      {/* Page heading */}
      <text x="20" y="58" fontSize="13" fontWeight="600" fill="var(--color-text)">
        {pageTitle}
      </text>
      {/* Highlighted call-to-action */}
      <rect x="20" y="72" width="150" height="28" rx="6" fill="var(--color-accent)" />
      <text
        x="95"
        y="90.5"
        fontSize="11"
        fontWeight="600"
        fill="var(--color-accent-contrast)"
        textAnchor="middle"
      >
        {button}
      </text>
      {/* Pointer suggesting the click */}
      <path
        d="M150 104l14 5-5 2 5 6-3 2-5-6-3 4z"
        fill="var(--color-text)"
        stroke="var(--color-bg)"
        strokeWidth="1"
      />
    </svg>
  )
}

interface TokenHelpProps {
  /** Which token's guidance to render. */
  kind: 'jira' | 'tempo'
}

/** Step-by-step guidance + illustration shown in the API-token help popover. */
export function TokenHelp({ kind }: TokenHelpProps): JSX.Element {
  const { t } = useTranslation()
  const base = kind === 'jira' ? 'settings.jiraTokenHelp' : 'settings.tempoTokenHelp'
  const steps = t(`${base}.steps`, { returnObjects: true }) as string[]
  return (
    <span className="token-help">
      <strong className="token-help-title">{t(`${base}.title`)}</strong>
      <BrowserMock
        address={t(`${base}.address`)}
        pageTitle={t(`${base}.pageTitle`)}
        button={t(`${base}.button`)}
      />
      <ol className="token-help-steps">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </span>
  )
}
