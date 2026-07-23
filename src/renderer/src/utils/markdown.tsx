import type { ReactNode } from 'react'
import { openExternal } from './external'

/**
 * Minimal, dependency-free markdown renderer for release notes. It handles the
 * small subset that appears in changelog entries and GitHub's auto-generated
 * notes: headings, unordered lists, bold, inline code and links. Anything else
 * renders as a plain paragraph, so unknown syntax degrades to readable text
 * rather than breaking. Links open in the system browser.
 */
export function renderMarkdown(source: string): JSX.Element {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  let key = 0

  const flushList = (): void => {
    if (list.length === 0) return
    blocks.push(<ul key={`ul-${key++}`}>{list}</ul>)
    list = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flushList()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushList()
      // Clamp to h4-h6 so notes never outrank the modal's own heading.
      const level = Math.min(6, Math.max(4, heading[1].length + 3))
      const Tag = `h${level}` as keyof JSX.IntrinsicElements
      blocks.push(<Tag key={`h-${key++}`}>{renderInline(heading[2])}</Tag>)
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      list.push(<li key={`li-${key++}`}>{renderInline(bullet[1])}</li>)
      continue
    }
    flushList()
    blocks.push(<p key={`p-${key++}`}>{renderInline(trimmed)}</p>)
  }
  flushList()

  return <div className="markdown">{blocks}</div>
}

/** Renders inline markdown (bold, code, links) inside a single text run. */
function renderInline(text: string): ReactNode[] {
  // One combined pass over the inline tokens we support, in priority order:
  // links [text](url), bold **text**, inline code `text`, then bare URLs
  // (common in GitHub's auto-generated notes). The link form comes first so a
  // markdown link's URL is not also matched as a bare URL.
  const pattern =
    /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+)/g
  const out: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  const link = (url: string, label: string): ReactNode => (
    <a
      key={`a-${key++}`}
      href={url}
      onClick={(e) => {
        e.preventDefault()
        openExternal(url)
      }}
    >
      {label}
    </a>
  )
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index))
    if (match[1] !== undefined) {
      out.push(link(match[2], match[1]))
    } else if (match[3] !== undefined) {
      out.push(<strong key={`b-${key++}`}>{match[3]}</strong>)
    } else if (match[4] !== undefined) {
      out.push(<code key={`c-${key++}`}>{match[4]}</code>)
    } else if (match[5] !== undefined) {
      out.push(link(match[5], match[5]))
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex))
  return out
}
