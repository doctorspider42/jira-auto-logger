/**
 * Small colored badge for a Jira issue type, following Jira's color
 * conventions. Jira's own icons cannot be loaded (CSP blocks remote images)
 * and type names may be localized, so classification is heuristic with the
 * API's reliable `subtask` flag as the primary signal.
 */

type IssueKind = 'epic' | 'story' | 'task' | 'bug' | 'subtask'

interface BadgeStyle {
  glyph: string
  background: string
}

const BADGES: Record<IssueKind, BadgeStyle> = {
  epic: { glyph: '⚡', background: '#904ee2' },
  story: { glyph: '◆', background: '#36b37e' },
  task: { glyph: '✓', background: '#4a90e2' },
  bug: { glyph: '●', background: '#e5493a' },
  subtask: { glyph: '⤷', background: '#2f9e9e' }
}

function classify(typeName: string, isSubtask: boolean): IssueKind | null {
  if (isSubtask) return 'subtask'
  const name = typeName.toLowerCase()
  if (!name) return null
  if (name.includes('sub') || name.includes('podzad')) return 'subtask'
  if (name.includes('epi')) return 'epic'
  if (name.includes('stor') || name.includes('histor')) return 'story'
  if (name.includes('bug') || name.includes('błąd') || name.includes('blad') || name.includes('defe')) {
    return 'bug'
  }
  return 'task'
}

interface IssueTypeIconProps {
  typeName: string
  isSubtask: boolean
}

export function IssueTypeIcon({ typeName, isSubtask }: IssueTypeIconProps): JSX.Element | null {
  const kind = classify(typeName, isSubtask)
  if (!kind) return null
  const badge = BADGES[kind]
  return (
    <span
      className="issue-type-badge"
      style={{ background: badge.background }}
      title={typeName || kind}
      aria-label={typeName || kind}
    >
      {badge.glyph}
    </span>
  )
}
