interface HelpTipProps {
  /** Accessible label for the trigger button. */
  label: string
  /** Which edge of the trigger the popover lines up with; `end` near the right edge. */
  align?: 'start' | 'end'
  /** Popover content shown on hover/focus. */
  children: React.ReactNode
}

/**
 * A small "?" affordance that reveals a rich popover on hover or keyboard
 * focus. Pure CSS visibility (`:hover`/`:focus-within`) so it needs no state;
 * the popover is a child of the trigger wrapper so moving the pointer into it
 * keeps it open. This is where explanations live: screens carry a short label
 * and put the paragraph here.
 */
export function HelpTip({ label, align = 'start', children }: HelpTipProps): JSX.Element {
  return (
    <span className={`help-tip ${align === 'end' ? 'help-tip-end' : ''}`}>
      <button type="button" className="help-tip-trigger" aria-label={label}>
        ?
      </button>
      <span className="help-tip-popover" role="tooltip">
        {children}
      </span>
    </span>
  )
}
