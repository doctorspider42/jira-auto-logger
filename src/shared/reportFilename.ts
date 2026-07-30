import type { ReportLayout } from './domain'

export const DEFAULT_REPORT_FILENAME_TEMPLATE = 'tempo-{layout}-{YYYY-MM}.pdf'

export type ReportFilenameTemplateError =
  | 'empty'
  | 'unknown-token'
  | 'missing-period'
  | 'invalid-character'
  | 'too-long'
  | 'reserved-name'

const TOKEN_PATTERN = /\{[^{}]+\}/g
const ALLOWED_TOKENS = new Set(['{MM}', '{YYYY}', '{YYYY-MM}', '{layout}'])
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function validateReportFilenameTemplate(
  template: string
): ReportFilenameTemplateError | null {
  const trimmed = template.trim()
  if (!trimmed) return 'empty'

  const tokens = trimmed.match(TOKEN_PATTERN) ?? []
  if (tokens.some((token) => !ALLOWED_TOKENS.has(token))) return 'unknown-token'
  if (/[{}]/.test(trimmed.replace(TOKEN_PATTERN, ''))) return 'unknown-token'

  const includesPeriod =
    trimmed.includes('{YYYY-MM}') ||
    (trimmed.includes('{YYYY}') && trimmed.includes('{MM}'))
  if (!includesPeriod) return 'missing-period'

  const sample = trimmed
    .replaceAll('{YYYY-MM}', '2026-06')
    .replaceAll('{YYYY}', '2026')
    .replaceAll('{MM}', '06')
    .replaceAll('{layout}', 'summary')
  if (INVALID_FILENAME_CHARACTERS.test(sample)) return 'invalid-character'

  const withExtension = /\.pdf$/i.test(sample) ? sample : `${sample}.pdf`
  if (withExtension.length > 180) return 'too-long'
  if (WINDOWS_RESERVED_NAME.test(withExtension)) return 'reserved-name'
  return null
}

export function formatReportFilename(
  template: string,
  month: string,
  layout: ReportLayout
): string {
  const templateError = validateReportFilenameTemplate(template)
  if (templateError) throw new Error(templateError)

  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new Error('invalid-month')

  const [, year, monthNumber] = match
  const rendered = template
    .trim()
    .replaceAll('{YYYY-MM}', `${year}-${monthNumber}`)
    .replaceAll('{YYYY}', year)
    .replaceAll('{MM}', monthNumber)
    .replaceAll('{layout}', layout)
  return /\.pdf$/i.test(rendered) ? rendered : `${rendered}.pdf`
}
