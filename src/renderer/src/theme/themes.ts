/**
 * Strings a theme may speak in its own voice. The texts themselves live in the
 * locale files (a theme must not hardcode language), under the subtree named
 * by `key`; this only says which subtree and how it combines with the defaults.
 */
export interface ThemeCopy {
  /** i18n subtree with this theme's strings, e.g. `themeCopy.clairObscur`. */
  key: string
  /**
   * What to do with the theme's `funnyLoading` array, if it has one: `extend`
   * adds its messages to the shared pool, `replace` uses only its own.
   */
  loadingMessages?: 'extend' | 'replace'
}

/**
 * Themes are plain maps of CSS custom properties. Adding a theme means
 * adding an entry here (or, in the future, loading one from user config).
 */
export interface Theme {
  id: string
  nameKey: string
  variables: Record<string, string>
  /**
   * Optional per-theme wording. Any key under the subtree wins over the same
   * key at the root of the locale file, so a theme can reword single labels
   * (see `useThemeText`) without touching the components that render them.
   */
  copy?: ThemeCopy
  /**
   * Kept out of the theme dropdown in Settings. The theme itself works
   * normally - `applyTheme` doesn't care - it just isn't offered, so reaching it
   * takes either the unlock sequence on the Settings screen, a hand-edited
   * `themeId` in config.json or `JAL_THEME=<id>` at launch. Once it is the
   * active theme the dropdown lists it again, otherwise the control would show
   * a value that isn't among its options.
   */
  hidden?: boolean
}

const shared = {
  // Which variant Chromium draws native widgets in (the time input's clock
  // icon, scrollbars, autofill). Dark themes override it; without it the icon
  // is painted near-black and disappears into a dark input.
  '--color-scheme': 'light',
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
      '--color-scheme': 'dark',
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
    id: 'iteoLight',
    nameKey: 'settings.themeIteoLight',
    variables: {
      ...shared,
      // iteo brand palette. Background, borders, graphite text and the orange
      // accent come straight from the brandbook; success reuses the brand
      // green. The brandbook defines no red, so the danger colour is picked to
      // sit far enough from the orange accent to never be mistaken for it.
      '--color-bg': '#f2f3f7',
      '--color-bg-raised': '#ffffff',
      '--color-bg-hover': '#e6e7eb',
      '--color-border': '#d4d4d5',
      '--color-text': '#040429',
      '--color-text-muted': '#525258',
      '--color-accent': '#ff6500',
      // Dark-on-orange, not the brandbook's white-on-orange: white only
      // reaches 2.9:1 against #ff6500, which is unreadable on small UI labels.
      '--color-accent-contrast': '#040429',
      '--color-accent-soft': 'rgba(255, 101, 0, 0.14)',
      '--color-danger': '#d32f45',
      '--color-success': '#00a150',
      '--color-warning': '#b67a00',
      '--color-selection': 'rgba(255, 101, 0, 0.22)',
      '--font-family': "'Codec Cold', Verdana, 'Segoe UI', sans-serif",
      '--shadow-popup': '0 12px 40px rgba(4, 4, 41, 0.18)'
    }
  },
  {
    id: 'iteoDark',
    nameKey: 'settings.themeIteoDark',
    variables: {
      ...shared,
      // Same brand palette on the graphite surface colour. #27272e is what the
      // brandbook actually fills dark areas with; #040429 is the ink colour and
      // stays reserved for text (as a full background its blue cast reads as
      // navy). Steps up from #27272e are kept neutral for the same reason.
      // Success and warning are lightened so they stay legible on it.
      '--color-scheme': 'dark',
      '--color-bg': '#27272e',
      '--color-bg-raised': '#32323a',
      '--color-bg-hover': '#3e3e47',
      '--color-border': '#4b4b55',
      '--color-text': '#f2f3f7',
      '--color-text-muted': '#a9a9ab',
      '--color-accent': '#ff6500',
      '--color-accent-contrast': '#040429',
      '--color-accent-soft': 'rgba(255, 101, 0, 0.18)',
      '--color-danger': '#ff5266',
      '--color-success': '#10c46b',
      '--color-warning': '#ffcb4d',
      '--color-selection': 'rgba(255, 101, 0, 0.30)',
      '--font-family': "'Codec Cold', Verdana, 'Segoe UI', sans-serif",
      '--shadow-popup': '0 12px 40px rgba(0, 0, 0, 0.55)'
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
      '--color-scheme': 'dark',
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
    '--color-scheme': 'dark',
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
  },
  {
    id: 'ps1',
    nameKey: 'settings.themePs1',
    variables: {
      ...shared,
      // Sony PlayStation BIOS: near-black blue CRT, and the four face-button
      // colours doing the semantic work (○ red, △ green, ✕ blue) with the
      // logo's yellow as the warning. Scanlines, dither and the hard bevels
      // are layered on by the scoped `[data-theme='ps1']` rules in ps1.css.
      '--color-scheme': 'dark',
      '--color-bg': '#0a0a16',
      '--color-bg-raised': '#16162b',
      '--color-bg-hover': '#232347',
      '--color-border': '#3c3c72',
      '--color-text': '#e8e8f4',
      '--color-text-muted': '#9a9ac4',
      '--color-accent': '#6c8cff',
      '--color-accent-contrast': '#06060f',
      '--color-accent-soft': 'rgba(108, 140, 255, 0.18)',
      '--color-danger': '#e4344a',
      '--color-success': '#3dbf7a',
      '--color-warning': '#ffc20e',
      '--color-selection': 'rgba(108, 140, 255, 0.32)',
      '--radius-sm': '0px',
      '--radius-md': '2px',
      '--radius-lg': '3px',
      '--font-family': "Verdana, Tahoma, 'Segoe UI', sans-serif",
      '--shadow-popup': '6px 6px 0 rgba(0, 0, 0, 0.65), 0 0 40px rgba(108, 140, 255, 0.22)'
    }
  },
  {
    id: 'helloKitty',
    nameKey: 'settings.themeHelloKitty',
    variables: {
      ...shared,
      // Soft pink Sanrio look: pale pink desk, white cards, hot-pink accents.
      '--color-bg': '#ffe4ef',
      '--color-bg-raised': '#ffffff',
      '--color-bg-hover': '#ffd6e8',
      '--color-border': '#ffb6d5',
      '--color-text': '#4a2c3a',
      '--color-text-muted': '#9c6b82',
      '--color-accent': '#ff4d94',
      '--color-accent-contrast': '#ffffff',
      '--color-accent-soft': 'rgba(255, 77, 148, 0.14)',
      '--color-danger': '#e63950',
      '--color-success': '#3fbf7f',
      '--color-warning': '#f5a623',
      '--color-selection': 'rgba(255, 77, 148, 0.22)',
      '--radius-sm': '10px',
      '--radius-md': '16px',
      '--radius-lg': '22px',
      '--font-family':
        "'Comic Sans MS', 'Segoe UI Rounded', 'Segoe UI Variable', 'Segoe UI', sans-serif",
      '--shadow-popup': '0 12px 40px rgba(255, 77, 148, 0.32)'
    }
  },
  {
    id: 'y2k',
    nameKey: 'settings.themeY2K',
    variables: {
      ...shared,
      // Peak-2002 Frutiger-Aero / chrome / aqua look. Light frosty-candy
      // surfaces keep the dark navy text readable everywhere; the glossy
      // bevels, holographic gradients and chrome are layered on top by the
      // scoped `[data-theme='y2k']` rules in y2k.css.
      '--color-bg': '#a7e6ff',
      '--color-bg-raised': '#f2fbff',
      '--color-bg-hover': '#dff3ff',
      '--color-border': '#5fb8e8',
      '--color-text': '#0b1a52',
      '--color-text-muted': '#3a5bb0',
      '--color-accent': '#ff2fd6',
      '--color-accent-contrast': '#ffffff',
      '--color-accent-soft': 'rgba(0, 200, 255, 0.22)',
      '--color-danger': '#ff2965',
      '--color-success': '#00d47f',
      '--color-warning': '#ffc400',
      '--color-selection': 'rgba(0, 224, 255, 0.4)',
      '--radius-sm': '10px',
      '--radius-md': '16px',
      '--radius-lg': '24px',
      '--font-family': "'Trebuchet MS', 'Verdana', 'Comic Sans MS', 'Segoe UI', sans-serif",
      '--shadow-popup':
        '0 0 0 2px #ffffff, 0 16px 44px rgba(0, 40, 120, 0.45), 0 0 34px rgba(0, 200, 255, 0.55)'
    }
  },
  {
    id: 'maaSnEk',
    nameKey: 'settings.themeMaaSnEk',
    hidden: true,
    variables: {
      ...shared,
      // Protest: a concrete wall, black paint, cardboard placards and red used
      // as paint. Everything is squared off (nobody rounds the corners of a
      // hand-cut placard) and the body font is a condensed photocopy-leaflet
      // sans; the heavy poster typeface, the drips, the tape and the slogans
      // are layered on by the scoped rules in maa-sn-ek.css.
      //
      // The surfaces are deliberately neutral grey, not red: a red canvas plus
      // a red accent plus diagonal stripes reads as a cold-war propaganda
      // poster rather than a street. Red only appears where paint would - the
      // slogan, the active tab, the primary action.
      //
      // That leaves no room for a red danger colour anyone could tell apart
      // from the accent, so danger is pushed towards crimson-pink AND
      // destructive buttons get a hazard-yellow outline in the scoped CSS,
      // which is what actually keeps them distinct from primary.
      '--color-scheme': 'dark',
      '--color-bg': '#16161a',
      '--color-bg-raised': '#202025',
      '--color-bg-hover': '#2b2b31',
      '--color-border': '#3c3c43',
      // Off-white poster paper rather than pure white.
      '--color-text': '#ecebe6',
      '--color-text-muted': '#9c9c96',
      '--color-accent': '#e0322b',
      '--color-accent-contrast': '#100403',
      '--color-accent-soft': 'rgba(224, 50, 43, 0.18)',
      '--color-danger': '#ff4d6d',
      '--color-success': '#3fcf6a',
      '--color-warning': '#ffd400',
      '--color-selection': 'rgba(224, 50, 43, 0.34)',
      '--radius-sm': '0px',
      '--radius-md': '0px',
      '--radius-lg': '0px',
      '--font-family': "'Arial Narrow', Arial, 'Helvetica Neue', 'Segoe UI', sans-serif",
      '--shadow-popup': '10px 10px 0 rgba(0, 0, 0, 0.8)'
    }
  },
  {
    id: 'clairObscur',
    nameKey: 'settings.themeClairObscur',
    // The expedition speaks for itself: its own loading messages instead of the
    // shared jokes, and "We continue" on the button that commits the day.
    copy: { key: 'themeCopy.clairObscur', loadingMessages: 'replace' },
    variables: {
      ...shared,
      // Clair Obscur: Expedition 33, sampled off its own menu screens: a black
      // oil canvas (#070606), ink-blot panels, bone-white serif text, and gold
      // doing all the accent work - the pale champagne #eccfa3 on headings, the
      // richer #f6c037 on anything emphasised.
      //
      // Gold is the colour of TYPE in this game, never of surfaces; the selected
      // tab is filled dark plum (#3a2132) instead. That split is enforced in
      // clair-obscur.css, which is also where the drifting petals live.
      '--color-scheme': 'dark',
      '--color-bg': '#070606',
      '--color-bg-raised': '#121110',
      '--color-bg-hover': '#1d1a17',
      // Warm off-white, not grey: every stroke in these menus is bone or
      // parchment, and a neutral grey border goes blue against this much black.
      '--color-border': '#4b443c',
      '--color-text': '#f2efe9',
      '--color-text-muted': '#a1968a',
      '--color-accent': '#f6c037',
      '--color-accent-contrast': '#1a1206',
      '--color-accent-soft': 'rgba(246, 192, 55, 0.14)',
      // The crimson of the health bars, lifted just far enough off the sampled
      // #952b26 to stay legible as small text on near-black.
      '--color-danger': '#b8382f',
      // The game has no green anywhere, so success takes the pale champagne and
      // accent keeps the saturated gold - they are told apart by lightness
      // rather than by hue, which is how the game separates them too.
      '--color-success': '#eccfa3',
      '--color-warning': '#c08a2e',
      '--color-selection': 'rgba(246, 192, 55, 0.28)',
      // Nothing in this interface is rounded. Rectangles, elongated hexagons and
      // rhombuses only - the softness comes from painted edges instead.
      '--radius-sm': '0px',
      '--radius-md': '0px',
      '--radius-lg': '0px',
      // An old-style serif, which is the single biggest thing that makes these
      // menus look like themselves. Constantia and Cambria ship with Windows,
      // Palatino and Garamond cover Office and macOS, so nothing is downloaded.
      '--font-family':
        "Constantia, 'Palatino Linotype', 'Book Antiqua', Garamond, Cambria, Georgia, 'Times New Roman', serif",
      '--shadow-popup': '0 22px 60px rgba(0, 0, 0, 0.85)'
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
