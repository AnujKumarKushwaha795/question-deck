// config.js — App-wide configuration
// -----------------------------------------------------------------------------
// Edit this file to change data sources, feature flags, or default settings.

const APP_CONFIG = Object.freeze({
  /** Base URL for the question-bank CDN (no trailing slash) */
  CDN_BASE: 'https://cdn.jsdelivr.net/gh/AnujKumarKushwaha795/question-bank-push@main',

  /** Cache-busting version string — bump when you push new JS files */
  VERSION: '23',

  /** Subject icon/colour map – add new subjects here */
  SUBJECT_META: {
    physics:     { icon: '\u26DB',  color: '#147d78' },
    chemistry:   { icon: '\uD83E\uDDEA', color: '#e07b39' },
    mathematics: { icon: '\u03A3',  color: '#5a6abf' },
    biology:     { icon: '\uD83D\uDD2C', color: '#3a9e5f' },
  },

  /** Default fallback for unknown subjects */
  SUBJECT_META_DEFAULT: { icon: '\uD83D\uDCDA', color: '#65737d' },

  /** Feature flags — set to false to disable a feature */
  FEATURES: {
    pdfExport: true,
    pptExport: true,
    search:    true,
  },
});
