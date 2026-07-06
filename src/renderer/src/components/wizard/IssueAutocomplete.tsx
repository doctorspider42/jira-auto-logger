import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JiraIssue } from '@shared/domain'
import { jiraIssueUrl, openExternal } from '@/utils/external'
import { IssueTypeIcon } from './IssueTypeIcon'

interface IssueAutocompleteProps {
  value: string
  /** Type of the currently selected issue, shown as a badge inside the input. */
  valueTypeName: string
  valueIsSubtask: boolean
  /** Connection to search in - each Jira has its own issues. */
  connectionId: string
  jiraBaseUrl: string
  projectKeys: string[]
  /** Called with the full issue on pick; null fields when typed manually. */
  onChange(issue: Pick<JiraIssue, 'key' | 'summary' | 'typeName' | 'isSubtask'>): void
}

const MAX_VISIBLE = 30
const POOL_TTL_MS = 5 * 60_000

/** Session cache of per-connection/project issue pools shared by all pickers. */
const poolCache = new Map<string, { fetchedAt: number; issues: JiraIssue[] }>()

async function loadPool(connectionId: string, projectKey: string): Promise<JiraIssue[]> {
  const cacheKey = `${connectionId}|${projectKey}`
  const cached = poolCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < POOL_TTL_MS) return cached.issues
  const result = await window.api.jira.getProjectIssues(connectionId, projectKey)
  const issues = result.ok ? result.value : []
  poolCache.set(cacheKey, { fetchedAt: Date.now(), issues })
  return issues
}

/** Every query word must appear somewhere in "KEY summary" (substring, case-insensitive). */
function matchesQuery(issue: JiraIssue, query: string): boolean {
  const haystack = `${issue.key} ${issue.summary}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * Issue picker combining two sources: the project's recent issues filtered
 * locally (instant, real substring matching - also inside words and on
 * partial keys) and a debounced server-side Jira search that reaches issues
 * outside the local pool. Results show the summary and a link to Jira.
 */
export function IssueAutocomplete({
  value,
  valueTypeName,
  valueIsSubtask,
  connectionId,
  jiraBaseUrl,
  projectKeys,
  onChange
}: IssueAutocompleteProps): JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState(value)
  const [pool, setPool] = useState<JiraIssue[]>([])
  const [remote, setRemote] = useState<JiraIssue[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)

  const projectKey = projectKeys[0] ?? ''

  useEffect(() => setText(value), [value])

  useEffect(() => {
    if (!projectKey) {
      setPool([])
      return
    }
    let cancelled = false
    void loadPool(connectionId, projectKey).then((issues) => !cancelled && setPool(issues))
    return () => {
      cancelled = true
    }
  }, [connectionId, projectKey])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // Server search complements the local pool (older issues, other wording).
  useEffect(() => {
    setRemote([])
    const query = text.trim()
    if (query.length < 2 || text === value) return
    const timer = setTimeout(() => {
      const id = ++requestId.current
      setSearching(true)
      void window.api.jira.searchIssues(connectionId, query, projectKeys).then((result) => {
        if (id !== requestId.current) return
        setSearching(false)
        if (result.ok) setRemote(result.value)
      })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const visible = useMemo(() => {
    const query = text.trim()
    const local = query ? pool.filter((i) => matchesQuery(i, query)) : pool
    const seen = new Set(local.map((i) => i.key))
    const merged = [...local, ...remote.filter((i) => !seen.has(i.key))]
    return merged.slice(0, MAX_VISIBLE)
  }, [pool, remote, text])

  const pick = (issue: JiraIssue): void => {
    onChange(issue)
    setText(issue.key)
    setOpen(false)
  }

  const selectedUrl = jiraIssueUrl(jiraBaseUrl, value)
  // The badge is shown only while the input mirrors the selected issue.
  const showBadge = Boolean(value) && text === value && Boolean(valueTypeName || valueIsSubtask)

  return (
    <div className="issue-autocomplete" ref={containerRef}>
      <div className="issue-autocomplete-input-row">
        {showBadge && (
          <span className="issue-input-badge">
            <IssueTypeIcon typeName={valueTypeName} isSubtask={valueIsSubtask} />
          </span>
        )}
        <input
          className={showBadge ? 'with-type-badge' : undefined}
          value={text}
          placeholder={t('wizard.issuePlaceholder')}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onBlur={() =>
            onChange({ key: text.trim().toUpperCase(), summary: '', typeName: '', isSubtask: false })
          }
          onFocus={() => setOpen(true)}
          spellCheck={false}
        />
        {searching && <span className="spinner issue-autocomplete-spinner" />}
        {!searching && selectedUrl && (
          <button
            type="button"
            className="issue-link-btn"
            title={t('wizard.openInJira')}
            onClick={() => openExternal(selectedUrl)}
          >
            ↗
          </button>
        )}
      </div>
      {open && visible.length > 0 && (
        <ul className="issue-autocomplete-list">
          {visible.map((issue) => {
            const url = jiraIssueUrl(jiraBaseUrl, issue.key)
            return (
              <li key={issue.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(issue)}>
                  <span className="issue-result-text">
                    <IssueTypeIcon typeName={issue.typeName} isSubtask={issue.isSubtask} />
                    <strong>{issue.key}</strong> {issue.summary}
                  </span>
                  {url && (
                    <span
                      className="issue-link-btn"
                      role="link"
                      title={t('wizard.openInJira')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation()
                        openExternal(url)
                      }}
                    >
                      ↗
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
