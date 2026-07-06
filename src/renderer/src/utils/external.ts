/**
 * Opens a URL in the system browser. The main process intercepts
 * window.open via setWindowOpenHandler and routes it to shell.openExternal.
 */
export const openExternal = (url: string): void => {
  window.open(url, '_blank')
}

/** Browse URL of a Jira issue; empty when the base URL is not configured. */
export function jiraIssueUrl(baseUrl: string, issueKey: string): string {
  if (!baseUrl || !issueKey) return ''
  return `${baseUrl.replace(/\/+$/, '')}/browse/${issueKey}`
}
