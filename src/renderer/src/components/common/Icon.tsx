/** Stroke icons drawn in the current text colour. Decorative by default. */
const PATHS: Record<string, JSX.Element> = {
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  projects: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  reports: <path d="M6 20V10M12 20V4M18 20v-7" />,
  /** Fold towards the left edge (hide the weekend). */
  foldLeft: <path d="M14 6l-6 6 6 6M20 6v12" />,
  /** Unfold to the right (show the weekend). */
  foldRight: <path d="M10 6l6 6-6 6M4 6v12" />,
  /** Side panel with an arrow pointing out: hide it. */
  panelHide: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M15 4.5v15M9 10l2 2-2 2" />
    </>
  ),
  /** Side panel with an arrow pointing in: show it. */
  panelShow: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M15 4.5v15M11 10l-2 2 2 2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12l5 5 9-10" />,
  code: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  branch: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  trash: <path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V5h6v2" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  history: <path d="M4 12a8 8 0 1 0 2.3-5.7M4 5v4h4M12 8v4l3 2" />,
  drag: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  )
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  )
}
