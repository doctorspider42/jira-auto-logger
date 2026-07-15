interface HelpTipProps {
  /** Accessible label for the trigger button. */
  label: string
  /** Popover content shown on hover/focus. */
  children: React.ReactNode
}

/**
 * A small "?" affordance that reveals a rich popover on hover or keyboard
 * focus. Pure CSS visibility (`:hover`/`:focus-within`) so it needs no state;
 * the popover is a child of the trigger wrapper so moving the pointer into it
 * keeps it open.
 */
export function HelpTip({ label, children }: HelpTipProps): JSX.Element {
  return (
    <span className="help-tip">
      <button type="button" className="help-tip-trigger" aria-label={label}>
        ?
      </button>
      <span className="help-tip-popover" role="tooltip">
        {children}
      </span>
    </span>
  )
}
