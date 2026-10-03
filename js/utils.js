// utils.js — Shared utility helpers
// -----------------------------------------------------------------------------
// Pure functions with no external deps. Import via <script> before app.js.

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str == null ? '' : str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * "alternating-current" -> "Alternating Current"
 * @param {string} slug
 * @returns {string}
 */
function slugToTitle(slug) {
  if (!slug || typeof slug !== 'string') return '';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

/**
 * Safely get display name from a hierarchy object.
 * Falls back to slugToTitle(id).
 * @param {{ name?: string, id?: string } | null} obj
 * @returns {string}
 */
function displayName(obj) {
  if (!obj) return '';
  if (typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
  return slugToTitle(typeof obj.id === 'string' ? obj.id : '');
}

/**
 * Get subject icon/colour from APP_CONFIG (or fallback).
 * @param {string} id  e.g. 'physics'
 * @returns {{ icon: string, color: string }}
 */
function subjectMeta(id) {
  var meta = APP_CONFIG.SUBJECT_META;
  return (meta && meta[id]) ? meta[id] : APP_CONFIG.SUBJECT_META_DEFAULT;
}

/**
 * Resolve a raw questionType string to a normalised type key.
 * Kept here so pdfGenerator / pptGenerator can share it.
 * @param {string} raw
 * @returns {string}
 */
function resolveQuestionType(raw) {
  if (!raw) return 'single-select';
  var map = {
    'single-select':   'single-select',
    'multiple-select': 'multiple-select',
    'integer':         'integer',
    'numerical':       'numerical',
    'match':           'match',
    'subjective':      'subjective',
    'fill-blanks':     'fill-blanks',
    'true-false':      'true-false',
    'mcq':             'single-select',
    'mcqm':            'multiple-select',
  };
  return map[raw.toLowerCase()] || raw;
}
