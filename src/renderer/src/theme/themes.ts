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
 * A theme changes five layers and never the layout: palette, type, shape,
 * texture and (optionally) voice. Spacing, density and hierarchy are the same
 * in every theme, so no theme can break a screen - a plain theme is one entry
 * here. The character themes (PS1, Clair Obscur, Animus, Y2K, maa-sn-ek...)
 * add an effects stylesheet in styles/themes/, scoped under their
 * `[data-theme]`, for what tokens can't express: CRT glass, falling petals,
 * bevels, banners.
 */
export interface ThemeTokens {
  /** Which variant the webview draws native widgets in (scrollbars, date pickers). */
  scheme: 'light' | 'dark'
  // ---- Palette. Every text colour is checked at 4.5:1 on ground and surface.
  /** Window background. */
  ground: string
  /** Panels, cards, inputs. */
  surface: string
  /** Hairlines and borders. */
  line: string
  /** Body text. */
  ink: string
  /** Secondary text; still 4.5:1. */
  muted: string
  /** Selection, today, focus and progress - used sparingly. */
  accent: string
  /** Text drawn on the accent. */
  accentInk: string
  /** The primary button. A colour, or a gradient where the theme calls for one. */
  primary: string
  primaryInk: string
  danger: string
  success: string
  warning: string
  // ---- Type
  fontBody: string
  fontDisplay: string
  fontMono: string
  /** `uppercase` for themes whose headings shout, else `none`. */
  displayCase?: string
  displayTracking?: string
  // ---- Shape
  /** Panels and cards. */
  radius: string
  /** Buttons, inputs, chips. `999px` makes pills. */
  radiusControl: string
  /** Box shadow of raised controls - bevels for Classic 95, else none. */
  bevel?: string
  // ---- Texture: at most one backdrop effect, never behind inputs.
  texture?: string
}

export interface Theme {
  id: string
  nameKey: string
  tokens: ThemeTokens
  /**
   * Optional per-theme wording. Any key under the subtree wins over the same
   * key at the root of the locale file, so a theme can reword single labels
   * (see `useThemeText`) without touching the components that render them.
   */
  copy?: ThemeCopy
  /**
   * The theme paints its own window canvas (styles/themes/<id>.css): the
   * system backdrop (Mica, Acrylic) is not let through, or it would wash the
   * painting out.
   */
  canvas?: boolean
  /**
   * Kept out of the theme picker in Settings. The theme works normally, it is
   * just not offered: reaching it takes the unlock sequence on the Settings
   * screen, a hand-edited `themeId` in config.json or `JAL_THEME=<id>`.
   */
  hidden?: boolean
}

const SANS = "Geist, 'Segoe UI Variable', 'Segoe UI', -apple-system, system-ui, sans-serif"
const MONO = "'Geist Mono', ui-monospace, 'Cascadia Code', Consolas, monospace"
const TERMINAL = "VT323, 'Cascadia Code', Consolas, monospace"
// Body copy of the terminal themes: VT323 is too small to read at 14px.
const TERMINAL_BODY = "'Cascadia Code', Consolas, 'Courier New', monospace"

export const THEMES: Theme[] = [
  {
    // Graphite - neutral greys, one periwinkle accent, a white primary button.
    id: 'dark',
    nameKey: 'settings.themeDark',
    tokens: {
      scheme: 'dark',
      ground: '#0c0d10',
      surface: '#131418',
      line: '#23262d',
      ink: '#edeef0',
      muted: '#8e939e',
      accent: '#9db4ff',
      accentInk: '#0c0d10',
      primary: '#edeef0',
      primaryInk: '#0c0d10',
      danger: '#ff8a7a',
      success: '#6fd8a0',
      warning: '#f0b85a',
      fontBody: SANS,
      fontDisplay: SANS,
      fontMono: MONO,
      radius: '14px',
      radiusControl: '9px'
    }
  },
  {
    // Paper - warm off-white, an ink-black primary button, cobalt for selection.
    id: 'light',
    nameKey: 'settings.themeLight',
    tokens: {
      scheme: 'light',
      ground: '#f6f5f1',
      surface: '#ffffff',
      line: '#e4e2dc',
      ink: '#18181b',
      muted: '#636260',
      accent: '#2f5bea',
      accentInk: '#ffffff',
      primary: '#18181b',
      primaryInk: '#ffffff',
      danger: '#c8372d',
      success: '#1d7f4e',
      warning: '#9a6200',
      fontBody: SANS,
      fontDisplay: SANS,
      fontMono: MONO,
      radius: '14px',
      radiusControl: '9px'
    }
  },
  {
    // iteo brand. Navy carries text and the primary button; the brand orange
    // only marks today, focus and progress - white or navy on #ff6500 is too
    // weak for small text, so orange never carries a label.
    id: 'iteoLight',
    nameKey: 'settings.themeIteoLight',
    tokens: {
      scheme: 'light',
      ground: '#f2f3f7',
      surface: '#ffffff',
      line: '#dcdde3',
      ink: '#040429',
      muted: '#52526a',
      accent: '#ff6500',
      accentInk: '#040429',
      primary: '#040429',
      primaryInk: '#ffffff',
      danger: '#d32f45',
      success: '#00a150',
      warning: '#9a6200',
      fontBody: "'Codec Cold', Geist, Verdana, 'Segoe UI', sans-serif",
      fontDisplay: "'Codec Cold', Geist, Verdana, 'Segoe UI', sans-serif",
      fontMono: MONO,
      radius: '12px',
      radiusControl: '8px'
    }
  },
  {
    id: 'iteoDark',
    nameKey: 'settings.themeIteoDark',
    tokens: {
      scheme: 'dark',
      ground: '#1d1d24',
      surface: '#27272e',
      line: '#3d3d47',
      ink: '#f2f3f7',
      muted: '#a6a6b4',
      accent: '#ff6500',
      accentInk: '#040429',
      primary: '#f2f3f7',
      primaryInk: '#040429',
      danger: '#ff7a8a',
      success: '#3fd08a',
      warning: '#f0b85a',
      fontBody: "'Codec Cold', Geist, Verdana, 'Segoe UI', sans-serif",
      fontDisplay: "'Codec Cold', Geist, Verdana, 'Segoe UI', sans-serif",
      fontMono: MONO,
      radius: '12px',
      radiusControl: '8px'
    }
  },
  {
    // Classic 95 - bevels only on real controls; the teal desktop shows
    // around the window, not behind content.
    id: 'win95',
    nameKey: 'settings.themeWin95',
    tokens: {
      scheme: 'light',
      ground: '#008080',
      surface: '#c0c0c0',
      line: '#808080',
      ink: '#000000',
      muted: '#303030',
      accent: '#000080',
      accentInk: '#ffffff',
      primary: '#c0c0c0',
      primaryInk: '#000000',
      danger: '#a00000',
      success: '#006000',
      warning: '#6b5200',
      fontBody: "Tahoma, 'MS Sans Serif', 'Segoe UI', sans-serif",
      fontDisplay: "Tahoma, 'MS Sans Serif', 'Segoe UI', sans-serif",
      fontMono: "'Courier New', monospace",
      radius: '0px',
      radiusControl: '0px',
      bevel: 'inset -1px -1px #0a0a0a, inset 1px 1px #ffffff, inset -2px -2px #808080, inset 2px 2px #dfdfdf'
    }
  },
  {
    // Vault Terminal - single-hue phosphor; scanlines on the backdrop only.
    id: 'fallout',
    nameKey: 'settings.themeFallout',
    tokens: {
      scheme: 'dark',
      ground: '#031008',
      surface: '#06160c',
      line: '#1d5c31',
      ink: '#3dff7d',
      muted: '#2bb45a',
      accent: '#3dff7d',
      accentInk: '#031008',
      primary: '#3dff7d',
      primaryInk: '#031008',
      danger: '#ff6a4d',
      success: '#3dff7d',
      warning: '#d8ff5a',
      fontBody: TERMINAL_BODY,
      fontDisplay: TERMINAL,
      fontMono: TERMINAL_BODY,
      displayCase: 'uppercase',
      displayTracking: '0.04em',
      radius: '0px',
      radiusControl: '0px',
      texture: 'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0 1px, transparent 1px 3px)'
    }
  },
  {
    // New Vegas - the same terminal in Mojave amber.
    id: 'falloutNV',
    nameKey: 'settings.themeFalloutNV',
    tokens: {
      scheme: 'dark',
      ground: '#120a03',
      surface: '#1a1005',
      line: '#6b4214',
      ink: '#ffb347',
      muted: '#d4923a',
      accent: '#ffbf5a',
      accentInk: '#120a03',
      primary: '#ffb347',
      primaryInk: '#120a03',
      danger: '#ff6a4d',
      success: '#c9e86a',
      warning: '#ffd27a',
      fontBody: TERMINAL_BODY,
      fontDisplay: TERMINAL,
      fontMono: TERMINAL_BODY,
      displayCase: 'uppercase',
      displayTracking: '0.04em',
      radius: '0px',
      radiusControl: '0px',
      texture: 'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0 1px, transparent 1px 3px)'
    }
  },
  {
    // Memory Card (PS1) - the BIOS screen: CRT glass, hard bevels, dither and
    // the four face-button colours. The effects live in styles/themes/ps1.css.
    id: 'ps1',
    nameKey: 'settings.themePs1',
    canvas: true,
    tokens: {
      scheme: 'dark',
      ground: '#0a0a16',
      surface: '#15152a',
      line: '#34346a',
      ink: '#e8e8f4',
      muted: '#a2a2c8',
      accent: '#6c8cff',
      accentInk: '#0a0a16',
      primary: '#6c8cff',
      primaryInk: '#0a0a16',
      danger: '#ff7a8a',
      success: '#6fe0a8',
      warning: '#f0c35a',
      fontBody: "Verdana, Tahoma, 'Segoe UI', sans-serif",
      fontDisplay: "Verdana, Tahoma, 'Segoe UI', sans-serif",
      fontMono: MONO,
      displayCase: 'uppercase',
      displayTracking: '0.12em',
      radius: '2px',
      radiusControl: '2px'
    }
  },
  {
    // Hello Kitty - round everything: pill buttons, Comic Sans headings over
    // Fredoka body copy, a quiet polka backdrop. Opaque: over the window
    // backdrop the pale pinks lost all their contrast.
    id: 'helloKitty',
    nameKey: 'settings.themeHelloKitty',
    canvas: true,
    tokens: {
      scheme: 'light',
      ground: '#ffe9f1',
      surface: '#ffffff',
      line: '#f5a8c8',
      ink: '#38202c',
      muted: '#6e3d56',
      accent: '#d92c74',
      accentInk: '#ffffff',
      primary: '#d92c74',
      primaryInk: '#ffffff',
      danger: '#c0263a',
      success: '#2f8a5a',
      warning: '#9a6200',
      fontBody: "Fredoka, 'Segoe UI', sans-serif",
      fontDisplay: "'Comic Sans MS', Fredoka, 'Segoe UI', sans-serif",
      fontMono: MONO,
      radius: '18px',
      radiusControl: '999px',
      texture: 'radial-gradient(#ffdbe8 1.3px, transparent 1.4px) 0 0 / 16px 16px'
    }
  },
  {
    // Y2K Chrome - Frutiger-Aero holographic sky, chrome and aqua candy; the
    // one theme where gradients are the character (styles/themes/y2k.css).
    id: 'y2k',
    nameKey: 'settings.themeY2K',
    canvas: true,
    tokens: {
      scheme: 'light',
      ground: '#cdefff',
      surface: '#f5fcff',
      line: '#8ccdf0',
      ink: '#0b1a52',
      muted: '#3d5687',
      accent: '#c3189f',
      accentInk: '#ffffff',
      primary: 'linear-gradient(#ff7be5, #c3189f)',
      primaryInk: '#ffffff',
      danger: '#c0263a',
      success: '#16804d',
      warning: '#8a5a00',
      fontBody: "'Trebuchet MS', Verdana, 'Segoe UI', sans-serif",
      fontDisplay: "Michroma, 'Trebuchet MS', sans-serif",
      fontMono: MONO,
      radius: '16px',
      radiusControl: '999px',
      bevel: 'inset 0 1px 0 rgba(255, 255, 255, 0.7)'
    }
  },
  {
    // maa-sn-ek - a picket line: concrete wall, placards, one red signal
    // (styles/themes/maa-sn-ek.css).
    id: 'maaSnEk',
    nameKey: 'settings.themeMaaSnEk',
    hidden: true,
    canvas: true,
    tokens: {
      scheme: 'dark',
      ground: '#16161a',
      surface: '#202025',
      line: '#3c3c43',
      ink: '#ecebe6',
      muted: '#a2a19b',
      accent: '#e0322b',
      accentInk: '#ffffff',
      primary: '#e0322b',
      primaryInk: '#ffffff',
      danger: '#ff6a5f',
      success: '#7fd49c',
      warning: '#f0c35a',
      fontBody: "'Archivo Narrow', 'Arial Narrow', Arial, sans-serif",
      fontDisplay: "'Archivo Narrow', 'Arial Narrow', Arial, sans-serif",
      fontMono: MONO,
      displayCase: 'uppercase',
      displayTracking: '0.02em',
      radius: '0px',
      radiusControl: '0px'
    }
  },
  {
    // Clair Obscur - an oil canvas with petals drifting over it, old-style
    // serif, gold only on type (styles/themes/clair-obscur.css).
    id: 'clairObscur',
    nameKey: 'settings.themeClairObscur',
    canvas: true,
    // The game's own voice: its loading lines, and "We Continue" on the button
    // that commits the day.
    copy: { key: 'themeCopy.clairObscur', loadingMessages: 'replace' },
    tokens: {
      scheme: 'dark',
      ground: '#070606',
      surface: '#121110',
      line: '#3a342d',
      ink: '#f2efe9',
      muted: '#a79f93',
      accent: '#f6c037',
      accentInk: '#070606',
      primary: '#f6c037',
      primaryInk: '#070606',
      danger: '#ff7a6a',
      success: '#eccfa3',
      warning: '#d9a441',
      // Constantia ships with Windows; Cormorant (bundled) stands in elsewhere.
      fontBody: "Constantia, 'Palatino Linotype', 'Cormorant Garamond', Garamond, Georgia, serif",
      fontDisplay: "Constantia, 'Palatino Linotype', 'Cormorant Garamond', Garamond, Georgia, serif",
      fontMono: MONO,
      displayTracking: '0.06em',
      radius: '0px',
      radiusControl: '0px'
    }
  },
  {
    // Animus - steel-blue sky with formulas rising through fog, slate blocks
    // with plain white type, cyan glints (styles/themes/animus.css).
    id: 'animus',
    nameKey: 'settings.themeAnimus',
    canvas: true,
    // Abstergo's loading lines, and "Synchronise" on the button that commits
    // the day - logging time is just syncing with a memory.
    copy: { key: 'themeCopy.animus', loadingMessages: 'replace' },
    tokens: {
      scheme: 'dark',
      ground: '#5d778b',
      surface: '#1b2630',
      line: '#4a6072',
      ink: '#f2f7fa',
      muted: '#b4c6d2',
      accent: '#3fd8ff',
      accentInk: '#04202b',
      primary: '#3fd8ff',
      primaryInk: '#04202b',
      danger: '#ff5c64',
      success: '#5ee3a8',
      warning: '#ffcf5a',
      fontBody: "'Inter Tight', Geist, sans-serif",
      fontDisplay: "'Inter Tight', Geist, sans-serif",
      fontMono: MONO,
      displayCase: 'uppercase',
      displayTracking: '0.08em',
      radius: '0px',
      radiusControl: '0px'
    }
  }
]

/** The CSS custom properties a theme sets on `<html>`; components use only these. */
function variablesOf(t: ThemeTokens): Record<string, string> {
  return {
    '--color-scheme': t.scheme,
    '--ground': t.ground,
    '--surface': t.surface,
    '--line': t.line,
    '--ink': t.ink,
    '--muted': t.muted,
    '--accent': t.accent,
    '--accent-ink': t.accentInk,
    '--primary': t.primary,
    '--primary-ink': t.primaryInk,
    '--danger': t.danger,
    '--success': t.success,
    '--warning': t.warning,
    '--font-body': t.fontBody,
    '--font-display': t.fontDisplay,
    '--font-mono': t.fontMono,
    '--display-case': t.displayCase ?? 'none',
    '--display-tracking': t.displayTracking ?? '-0.02em',
    '--radius': t.radius,
    '--radius-control': t.radiusControl,
    '--bevel': t.bevel ?? 'none',
    '--texture': t.texture ?? 'none'
  }
}

export function themeById(themeId: string): Theme {
  return THEMES.find((t) => t.id === themeId) ?? THEMES[0]
}

export function applyTheme(themeId: string): void {
  const theme = themeById(themeId)
  const root = document.documentElement
  for (const [name, value] of Object.entries(variablesOf(theme.tokens))) {
    root.style.setProperty(name, value)
  }
  root.dataset.theme = theme.id
  root.dataset.scheme = theme.tokens.scheme
  if (theme.canvas) root.dataset.canvas = ''
  else delete root.dataset.canvas
}
