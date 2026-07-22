/**
 * Themes are plain maps of CSS custom properties. Adding a theme means
 * adding an entry here (or, in the future, loading one from user config).
 */
export interface Theme {
  id: string
  nameKey: string
  variables: Record<string, string>
}

const shared = {
  '--radius-sm': '6px',
  '--radius-md': '10px',
  '--radius-lg': '14px',
  '--font-family':
    "'Segoe UI Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Inter', Roboto, 'Helvetica Neue', Arial, sans-serif",
  '--shadow-popup': '0 12px 40px rgba(0, 0, 0, 0.35)'
}

export const THEMES: Theme[] = [
  {
    id: 'dark',
    nameKey: 'settings.themeDark',
    variables: {
      ...shared,
      '--color-bg': '#111318',
      '--color-bg-raised': '#1a1d24',
      '--color-bg-hover': '#232733',
      '--color-border': '#2c3140',
      '--color-text': '#e8eaf0',
      '--color-text-muted': '#9aa1b2',
      '--color-accent': '#6d9eff',
      '--color-accent-contrast': '#0d1117',
      '--color-accent-soft': 'rgba(109, 158, 255, 0.16)',
      '--color-danger': '#ff6b6b',
      '--color-success': '#4fd28a',
      '--color-warning': '#ffc857',
      '--color-selection': 'rgba(109, 158, 255, 0.28)',
      '--shadow-popup': '0 12px 40px rgba(0, 0, 0, 0.55)'
    }
  },
  {
    id: 'light',
    nameKey: 'settings.themeLight',
    variables: {
      ...shared,
      '--color-bg': '#f5f6f8',
      '--color-bg-raised': '#ffffff',
      '--color-bg-hover': '#eceef2',
      '--color-border': '#d8dce4',
      '--color-text': '#1d2330',
      '--color-text-muted': '#5d6575',
      '--color-accent': '#2f6fed',
      '--color-accent-contrast': '#ffffff',
      '--color-accent-soft': 'rgba(47, 111, 237, 0.12)',
      '--color-danger': '#d64545',
      '--color-success': '#1f9d5f',
      '--color-warning': '#c98a12',
      '--color-selection': 'rgba(47, 111, 237, 0.18)',
      '--shadow-popup': '0 12px 40px rgba(30, 40, 60, 0.18)'
    }
  },
  {
    id: 'win95',
    nameKey: 'settings.themeWin95',
    variables: {
      ...shared,
      // Teal desktop, gray window chrome, navy title-bar accents.
      '--color-bg': '#008080',
      '--color-bg-raised': '#c0c0c0',
      '--color-bg-hover': '#d4d0c8',
      '--color-border': '#808080',
      '--color-text': '#000000',
      '--color-text-muted': '#3f3f3f',
      '--color-accent': '#000080',
      '--color-accent-contrast': '#ffffff',
      '--color-accent-soft': 'rgba(0, 0, 128, 0.15)',
      '--color-danger': '#aa0000',
      '--color-success': '#007000',
      '--color-warning': '#7a6a00',
      '--color-selection': 'rgba(0, 0, 128, 0.25)',
      '--radius-sm': '0px',
      '--radius-md': '0px',
      '--radius-lg': '0px',
      '--font-family': "Tahoma, 'MS Sans Serif', 'Segoe UI', sans-serif",
      '--shadow-popup': '3px 3px 0 rgba(0, 0, 0, 0.5)'
    }
  },
  {
    id: 'fallout',
    nameKey: 'settings.themeFallout',
    variables: {
      ...shared,
      // Phosphor-green CRT terminal.
      '--color-bg': '#031008',
      '--color-bg-raised': '#07190d',
      '--color-bg-hover': '#0c2a15',
      '--color-border': '#1d5c31',
      '--color-text': '#2fe36b',
      '--color-text-muted': '#1e9c4a',
      '--color-accent': '#3dff7d',
      '--color-accent-contrast': '#031008',
      '--color-accent-soft': 'rgba(61, 255, 125, 0.14)',
      '--color-danger': '#ff6b4a',
      '--color-success': '#3dff7d',
      '--color-warning': '#ffd24a',
      '--color-selection': 'rgba(61, 255, 125, 0.24)',
      '--radius-sm': '2px',
      '--radius-md': '3px',
      '--radius-lg': '4px',
      '--font-family': "'Cascadia Code', Consolas, 'Courier New', monospace",
      '--shadow-popup': '0 0 28px rgba(61, 255, 125, 0.25)'
    }
  },
  {
  id: 'falloutNV',
  nameKey: 'settings.themeFalloutNV',
  variables: {
    ...shared,
    // Fallout: New Vegas amber Pip-Boy CRT.
    '--color-bg': '#120a03',
    '--color-bg-raised': '#1a1005',
    '--color-bg-hover': '#261708',
    '--color-border': '#8b5518',
    '--color-text': '#ffb347',
    '--color-text-muted': '#c98933',
    '--color-accent': '#ffbf5a',
    '--color-accent-contrast': '#120a03',
    '--color-accent-soft': 'rgba(255, 191, 90, 0.14)',
    '--color-danger': '#ff6240',
    '--color-success': '#ffbf5a',
    '--color-warning': '#ffd56a',
    '--color-selection': 'rgba(255, 191, 90, 0.24)',
    '--radius-sm': '2px',
    '--radius-md': '3px',
    '--radius-lg': '4px',
    '--font-family': "'Cascadia Code', Consolas, 'Courier New', monospace",
    '--shadow-popup': '0 0 28px rgba(255, 191, 90, 0.28)'
  }
  }
]

export function applyTheme(themeId: string): void {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.variables)) {
    root.style.setProperty(name, value)
  }
  root.dataset.theme = theme.id
}
