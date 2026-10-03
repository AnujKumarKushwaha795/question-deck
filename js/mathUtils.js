/**
 * mathUtils.js
 *
 * Complete rendering pipeline — full port of:
 *   D:\pdf_to_latex\Question_Rendering\questionRenderer.js
 *   D:\pdf_to_latex\Question_Rendering\katexProcessor.js
 *
 * Supports (detected automatically, no flags needed):
 *   \(...\)   — inline math
 *   \[...\]   — display/block math
 *   $$...$$   — display math (legacy / articles)
 *   $...$     — inline math (legacy / articles)
 *   **bold**, *italic*, ^(sup), _(sub)  — markdown
 *   Bare LaTeX commands (\sum, \frac, \sqrt …) without explicit delimiters
 *   HTML entities (&lt; &gt; &amp; etc.) — decoded inside math blocks
 *   Prose LaTeX (\alpha → α etc.)
 *   Multi-paragraph content (split on \n\n)
 */

// ── Private placeholder characters (PUA, will never appear in real content) ──
const MATH_PLACEHOLDER   = '\uE000';
const INLINE_PLACEHOLDER = '\uE001';

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[ch]);
}

/**
 * Decode HTML entities — uses browser textarea trick for full coverage.
 * Fast-paths when no '&' is present.
 * Also repairs double-encoded UTF-8 (mojibake): bytes that were UTF-8,
 * got misread as Latin-1, then stored as Unicode code-points.
 */
function decodeHtmlEntities(s) {
  s = String(s || '')
    .replace(/&lt;/g,  '<').replace(/&gt;/g,  '>').replace(/&amp;/g, '&')
    .replace(/&le;/g,  '≤').replace(/&ge;/g,  '≥').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&ne;/g,  '≠').replace(/&plusmn;/g, '±')
    .replace(/&times;/g, '×').replace(/&divide;/g, '÷').replace(/&middot;/g, '·')
    .replace(/&infin;/g, '∞').replace(/&alpha;/g, 'α').replace(/&beta;/g,  'β')
    .replace(/&gamma;/g, 'γ').replace(/&delta;/g, 'δ').replace(/&theta;/g, 'θ')
    .replace(/&lambda;/g,'λ').replace(/&mu;/g,   'μ').replace(/&pi;/g,    'π')
    .replace(/&sigma;/g, 'σ').replace(/&omega;/g, 'ω').replace(/&phi;/g,   'φ')
    .replace(/&psi;/g,   'ψ').replace(/&xi;/g,   'ξ').replace(/&eta;/g,   'η')
    .replace(/&epsilon;/g,'ε').replace(/&tau;/g,  'τ').replace(/&rho;/g,   'ρ')
    .replace(/&nu;/g,    'ν').replace(/&kappa;/g, 'κ').replace(/&chi;/g,   'χ')
    .replace(/&zeta;/g,  'ζ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ');   // non-breaking space → regular space (prevents ◆ artifact)
  // Repair double-encoded UTF-8 (mojibake):
  // Any char with ordinal 0x80-0xFF may be a mis-decoded UTF-8 byte.
  // Re-encode to latin-1 byte values, then decode as UTF-8 to recover the original.
  if (/[\x80-\xff]/.test(s)) {
    try {
      // Re-encode to latin-1 byte values, then decode as UTF-8
      const bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
      s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) { /* leave as-is if decode fails */ }
  }
  return s;
}

// ─── fixLatex — ported from katexProcessor.js ────────────────────────────────

function fixLatex(s) {
  // 0-pre) Convert legacy TeX \matrix{...rows...\cr} to \begin{matrix}...\end{matrix}
  // Uses balanced-brace matching because matrix cells contain nested {} groups.
  s = (function convertMatrix(src) {
    let result = '';
    let i = 0;
    while (i < src.length) {
      // Look for \matrix followed by optional whitespace then {
      const mIdx = src.indexOf('\\matrix', i);
      if (mIdx === -1) { result += src.slice(i); break; }
      result += src.slice(i, mIdx);
      // Skip \matrix and optional whitespace
      let j = mIdx + 7;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
      if (j >= src.length || src[j] !== '{') {
        // Not followed by { — emit as-is
        result += '\\matrix';
        i = mIdx + 7;
        continue;
      }
      // Find matching closing brace (balanced)
      let depth = 1;
      let k = j + 1;
      while (k < src.length && depth > 0) {
        if (src[k] === '\\' && k + 1 < src.length) { k += 2; continue; }
        if (src[k] === '{') depth++;
        else if (src[k] === '}') depth--;
        k++;
      }
      // src[j+1 .. k-2] is the body (inside the braces)
      let body = src.slice(j + 1, k - 1);
      // Remove trailing \cr and whitespace
      body = body.replace(/\\cr\s*$/, '').trim();
      // Convert \cr row separators to \\
      body = body.replace(/\\cr/g, '\\\\');
      result += `\\begin{matrix}${body}\\end{matrix}`;
      i = k;
    }
    return result;
  })(s);

  // 0a) Escape unescaped %
  s = s.replace(/(?<!\\)%/g, '\\%');
  // 0a.1) Escape unescaped #
  s = s.replace(/(?<!\\)#/g, '\\#');
  // 0a.2) Normalize \raise/\lower \hbox fraction-as-superscript TeX trick
  //   \raise0.5ex\hbox{$\scriptstyle N$}\kern...\kern...\lower0.25ex\hbox{$\scriptstyle M$}
  //   → \frac{N}{M}
  s = s.replace(
    /\\raise[\d.]*ex\\hbox\{\$?\\scriptstyle\s*([^$}]+?)\$?\}\s*\\kern[^\\]*\\kern[^\\]*\\lower[\d.]*ex\\hbox\{\$?\\scriptstyle\s*([^$}]+?)\$?\}/gs,
    (_, num, den) => `\\frac{${num.trim()}}{${den.trim()}}`
  );
  // 0b) Fix \text without braces
  s = s.replace(/\\text\s+([A-Za-z]+)/g, '\\text{$1}');
  // 0c) Split malformed unit superscripts
  s = s.replace(
    /(\^|_)\{(-?\d+)\s+([A-Za-z][A-Za-z ·]*)\}/g,
    (_, sc, num, unit) => `${sc}{${num}}\\,\\text{${unit.trim()}}`
  );
  // 0d) Fix unclosed \text{ containing another \text{
  s = s.replace(/\\text\{([^\}]+?)\\text\{/g, '\\text{$1} \\text{');
  // 0e) Merge double superscripts
  s = s.replace(/\^\{([^}]*)\}\s*\^\{([^}]*)\}/g, '^{$1\\,$2}');
  s = s.replace(/_\{([^}]*)\}\s*_\{([^}]*)\}/g,   '_{$1\\,$2}');
  // 0f) Fix unmatched \left/\right
  const lc = (s.match(/\\left\b/g)  || []).length;
  const rc = (s.match(/\\right\b/g) || []).length;
  if (lc !== rc) {
    s = s.replace(/\\left\s*([([|.])/g,  '$1');
    s = s.replace(/\\left\s*\\([{}])/g,  '\\$1');
    s = s.replace(/\\right\s*([)\]|.])/g, '$1');
    s = s.replace(/\\right\s*\\([{}])/g,  '\\$1');
  }

  // Phase 1 – fix unclosed braces before brackets
  let out1 = '';
  let bd = 0;
  const bkd = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { out1 += ch + s[i+1]; i++; continue; }
    if (ch === '{') { bd++; out1 += ch; }
    else if (ch === '}') { if (bd > 0) { bd--; out1 += ch; } }
    else if (ch === '[') { bkd.push(bd); out1 += ch; }
    else if (ch === ']') {
      if (bkd.length > 0) { const ex = bkd.pop(); while (bd > ex) { out1 += '}'; bd--; } }
      out1 += ch;
    } else { out1 += ch; }
  }
  while (bd > 0) { out1 += '}'; bd--; }

  // Phase 2 – fix \text{...} containing _ or ^
  let out2 = ''; let i = 0;
  while (i < out1.length) {
    if (out1[i] === '\\' && out1.slice(i, i+6) === '\\text{') {
      let d = 1, j = i + 6;
      while (j < out1.length && d > 0) {
        if (out1[j] === '{') d++;
        else if (out1[j] === '}') d--;
        if (d > 0) j++;
      }
      let ct = out1.slice(i+6, j);
      out2 += (ct.includes('_') || ct.includes('^'))
        ? `\\mathrm{${ct.replace(/ /g, '~')}}`
        : `\\text{${ct}}`;
      i = j + 1; continue;
    }
    out2 += out1[i]; i++;
  }
  return out2;
}

// ─── KaTeX rendering ──────────────────────────────────────────────────────────

const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: false,
  output: 'html',
  macros: { '\\unit': '\\,\\text{#1}' },
};

function renderKatex(latex, displayMode = false) {
  if (!latex || typeof latex !== 'string') return '';
  const fixed = fixLatex(latex);
  try {
    return katex.renderToString(fixed, { ...KATEX_OPTIONS, displayMode });
  } catch (err) {
    const esc = fixed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<span class="katex-error" title="${escapeHtml(err.message)}">${esc}</span>`;
  }
}

// ─── Step 0: Coalesce multi-paragraph math blocks ────────────────────────────
// Ported verbatim from questionRenderer.js coalesceMathBlocks()

function coalesceMathBlocks(s) {
  let out = '';
  let i = 0;
  const n = s.length;

  while (i < n) {
    if (s[i] === '\\' && i + 1 < n) {
      const opener = s[i + 1];
      if (opener === '(' || opener === '[') {
        const isDisplay = opener === '[';
        const closeChar = isDisplay ? ']' : ')';
        const startPos = i;
        out += '\\' + opener;
        i += 2;

        let inner = '';
        let braceDepth = 0;
        let inStray = false;
        let foundCloser = false;

        while (i < n) {
          if (s[i] === '\\' && i+1 < n && s[i+1] === closeChar) {
            braceDepth = 0; inStray = false; i += 2; foundCloser = true; break;
          }
          if (inStray && s[i] === '\\' && i+1 < n && s[i+1] === ')') {
            inner += '}'.repeat(braceDepth); braceDepth = 0; inStray = false; i += 2; continue;
          }
          if (!isDisplay && !inStray && s[i] === '\\' && i+1 < n && s[i+1] === opener) {
            inner += s[i] + s[i+1]; i += 2; continue;
          }
          if (isDisplay && !inStray && s[i] === '\\' && i+1 < n && s[i+1] === '(') {
            if (braceDepth > 0) { inner += '}'.repeat(braceDepth); braceDepth = 0; }
            inner += ' '; inStray = true; i += 2; continue;
          }
          if (s[i] === '\\' && i+1 < n && s[i+1] === '\\') { inner += '\\\\'; i += 2; continue; }
          if (s[i] === '\\' && i+1 < n && (s[i+1] === '{' || s[i+1] === '}')) {
            inner += s[i] + s[i+1]; i += 2; continue;
          }
          if (s[i] === '{') { braceDepth++; inner += '{'; i++; continue; }
          if (s[i] === '}') { if (braceDepth > 0) braceDepth--; inner += '}'; i++; continue; }
          if (s[i] === '\n' && i+1 < n && s[i+1] === '\n') {
            inner += '\n'; i += 2;
            while (i < n && s[i] === '\n') i++;
            continue;
          }
          inner += s[i]; i++;
        }

        if (!foundCloser) { i = startPos + 2; continue; }
        out += inner + '\\' + closeChar;
        continue;
      }
    }
    out += s[i]; i++;
  }
  return out;
}

// ─── Bare LaTeX command set ───────────────────────────────────────────────────
// Ported from questionRenderer.js BARE_LATEX_COMMANDS

const BARE_LATEX_COMMANDS = new Set([
  'xrightarrow','xleftarrow','xmapsto','xhookrightarrow','xhookleftarrow',
  'xRightarrow','xLeftarrow','xleftrightarrow',
  'overset','underset','stackrel',
  'frac','dfrac','tfrac','cfrac',
  'sum','prod','int','oint','iint','iiint',
  'lim','limsup','liminf',
  'sqrt',
  'left','right',
  'begin','end',
  'text','mathrm','mathbf','mathit','mathsf','mathtt','mathbb','boldsymbol',
  'vec','hat','bar','dot','ddot','tilde','check',
  'overline','underline','overbrace','underbrace','widetilde','widehat',
  'ce',
  'displaystyle','textstyle',
]);

// English words that mark the end of a bare LaTeX expression at depth 0.
// When collectBareLatex is at depth 0 and sees " WORD" where WORD is in this
// set, it stops — preventing "then", "where" etc. from being absorbed into math.
const PROSE_STOP_WORDS = new Set([
  'then','where','and','for','if','the','or','is','are','which','that',
  'when','with','from','into','onto','over','under','such','let','so',
  'be','by','in','of','on','at','to','as','an','a','but','not',
  'has','have','had','was','were','will','can','may','must','than',
]);

function isBareLatexCmd(s, i) {
  if (i >= s.length || s[i] !== '\\') return false;
  let j = i + 1;
  while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
  if (j === i + 1) return false;
  return BARE_LATEX_COMMANDS.has(s.slice(i + 1, j));
}

function collectBareLatex(s, start) {
  let i = start;
  const n = s.length;
  let latex = '';
  let braceDepth = 0, bracketDepth = 0, parenDepth = 0;

  while (i < n) {
    const ch = s[i];
    if (ch === '{') { braceDepth++; latex += ch; i++; continue; }
    if (ch === '}') {
      if (braceDepth > 0) { braceDepth--; latex += ch; i++; continue; }
      break;
    }
    if (ch === '[' && braceDepth === 0) { bracketDepth++; latex += ch; i++; continue; }
    if (ch === ']' && braceDepth === 0) {
      if (bracketDepth > 0) { bracketDepth--; latex += ch; i++; continue; }
      break;
    }
    if (ch === '(' && braceDepth === 0 && bracketDepth === 0) { parenDepth++; latex += ch; i++; continue; }
    if (ch === ')' && braceDepth === 0 && bracketDepth === 0) {
      if (parenDepth > 0) { parenDepth--; latex += ch; i++; continue; }
      break;
    }
    if (braceDepth > 0 || bracketDepth > 0 || parenDepth > 0) { latex += ch; i++; continue; }
    if (ch === '\\' && i+1 < n) {
      const nextCh = s[i+1];
      if (nextCh === '(' || nextCh === ')' || nextCh === '[' || nextCh === ']') break;
      if (nextCh === '\\') { latex += '\\\\'; i += 2; continue; }
      let j = i + 1;
      while (j < n && /[a-zA-Z]/.test(s[j])) j++;
      if (j > i + 1) { latex += s.slice(i, j); i = j; continue; }
      if (/[,;:!^_{}|.#']/.test(nextCh)) { latex += s.slice(i, i+2); i += 2; continue; }
      break;
    }
    if (ch === '\n') break;
    // Characters allowed in LaTeX math at depth 0
    // IMPORTANT: at depth 0, check for English prose words and stop.
    // This prevents "then", "where", etc. from being swallowed into math.
    if (/[a-zA-Z0-9 \t_^+\-=|<>~.,#'/\u00C0-\u024F\u0370-\u03FF\u2000-\u2BFF]/.test(ch)) {
      // Space check: if next non-space chars form a prose word, stop.
      if ((ch === ' ' || ch === '\t') && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
        // Peek ahead to see if we have a prose word (letter sequence not starting with \)
        let peek = i + 1;
        while (peek < n && (s[peek] === ' ' || s[peek] === '\t')) peek++;
        if (peek < n && s[peek] !== '\\') {
          // Read the upcoming word
          let wStart = peek;
          while (peek < n && /[a-zA-Z]/.test(s[peek])) peek++;
          const word = s.slice(wStart, peek).toLowerCase();
          if (word.length >= 2 && PROSE_STOP_WORDS.has(word)) {
            break; // stop before the prose word
          }
        }
      }
      latex += ch; i++; continue;
    }
    break;
  }

  return { end: i, latex: latex.trim() };
}

// ─── State machine: extract explicit + bare LaTeX in one pass ─────────────────
// Ported verbatim from questionRenderer.js extractMathTokens()

function extractMathTokens(s) {
  const tokens = [];
  let out = '';
  let i = 0;
  const n = s.length;

  while (i < n) {
    if (s[i] === '\\' && i+1 < n) {
      const next = s[i+1];

      // Explicit math delimiter
      if (next === '(' || next === '[') {
        const displayMode = next === '[';
        const startPos = i;
        i += 2;
        let latex = '';
        let depth = 1;
        let found = false;

        while (i < n) {
          if (s[i] === '\\' && i+1 < n && s[i+1] === '\\') { latex += '\\\\'; i += 2; continue; }
          if (s[i] === '\\' && i+1 < n && s[i+1] === next) { depth++; i += 2; continue; }
          if (s[i] === '\\' && i+1 < n && s[i+1] === (displayMode ? ']' : ')')) {
            depth--;
            if (depth === 0) { i += 2; found = true; break; }
            i += 2; continue;
          }
          latex += s[i]; i++;
        }

        if (!found) { out += '\\' + next; i = startPos + 2; continue; }

        latex = decodeHtmlEntities(latex).trim();
        if (!latex) continue;
        const idx = tokens.length;
        tokens.push({ latex, display: displayMode });
        out += `${MATH_PLACEHOLDER}${idx}${MATH_PLACEHOLDER}`;
        continue;
      }

      // Bare LaTeX command
      if (isBareLatexCmd(s, i)) {
        const { end, latex } = collectBareLatex(s, i);
        if (latex && end > i) {
          const decoded = decodeHtmlEntities(latex);
          const idx = tokens.length;
          tokens.push({ latex: decoded, display: false });
          out += `${MATH_PLACEHOLDER}${idx}${MATH_PLACEHOLDER}`;
          i = end;
          continue;
        }
      }
    }
    out += s[i]; i++;
  }

  return { out, tokens };
}

// ─── Convert $ / $$ delimiters ───────────────────────────────────────────────

function convertDollarMath(s) {
  if (!s.includes('$')) return s;
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, l) => `\\[${l}\\]`);
  s = s.replace(/\$([^$\n][^$\n]*?)\$/g, (_, l) => `\\(${l}\\)`);
  return s;
}

// ─── Prose LaTeX → Unicode ────────────────────────────────────────────────────
// Ported from questionRenderer.js PROSE_LATEX_MAP

const PROSE_LATEX_MAP = [
  [/\\,\s*/g, '\u2009'], [/\\;\s*/g, '\u2002'], [/\\ (?=\S)/g, '\u00A0'], [/\\!/g, ''],
  [/\\alpha\b/g,'α'],[/\\beta\b/g,'β'],[/\\gamma\b/g,'γ'],[/\\delta\b/g,'δ'],
  [/\\epsilon\b/g,'ε'],[/\\varepsilon\b/g,'ε'],[/\\zeta\b/g,'ζ'],[/\\eta\b/g,'η'],
  [/\\theta\b/g,'θ'],[/\\vartheta\b/g,'θ'],[/\\iota\b/g,'ι'],[/\\kappa\b/g,'κ'],
  [/\\lambda\b/g,'λ'],[/\\mu\b/g,'μ'],[/\\nu\b/g,'ν'],[/\\xi\b/g,'ξ'],
  [/\\pi\b/g,'π'],[/\\varpi\b/g,'π'],[/\\rho\b/g,'ρ'],[/\\varrho\b/g,'ρ'],
  [/\\sigma\b/g,'σ'],[/\\varsigma\b/g,'ς'],[/\\tau\b/g,'τ'],[/\\upsilon\b/g,'υ'],
  [/\\phi\b/g,'φ'],[/\\varphi\b/g,'φ'],[/\\chi\b/g,'χ'],[/\\psi\b/g,'ψ'],
  [/\\omega\b/g,'ω'],
  [/\\Gamma\b/g,'Γ'],[/\\Delta\b/g,'Δ'],[/\\Theta\b/g,'Θ'],[/\\Lambda\b/g,'Λ'],
  [/\\Xi\b/g,'Ξ'],[/\\Pi\b/g,'Π'],[/\\Sigma\b/g,'Σ'],[/\\Upsilon\b/g,'Υ'],
  [/\\Phi\b/g,'Φ'],[/\\Psi\b/g,'Ψ'],[/\\Omega\b/g,'Ω'],
  [/\\infty\b/g,'∞'],[/\\pm\b/g,'±'],[/\\mp\b/g,'∓'],[/\\times\b/g,'×'],
  [/\\div\b/g,'÷'],[/\\cdot\b/g,'·'],[/\\neq\b/g,'≠'],[/\\leq\b/g,'≤'],
  [/\\geq\b/g,'≥'],[/\\approx\b/g,'≈'],[/\\equiv\b/g,'≡'],
  [/\\rightarrow\b/g,'→'],[/\\leftarrow\b/g,'←'],[/\\Rightarrow\b/g,'⇒'],
  [/\\Leftarrow\b/g,'⇐'],[/\\leftrightarrow\b/g,'↔'],[/\\to\b/g,'→'],
  [/\\dots\b/g,'…'],[/\\ldots\b/g,'…'],[/\\cdots\b/g,'⋯'],
  [/\\[,;:!]/g, ' '],
  [/\\%/g,'%'],[/\\\$/g,'$'],
];

function applyProseLatexMap(s) {
  if (!/\\[a-zA-Z,;:! ]/.test(s)) return s;
  for (const [p, r] of PROSE_LATEX_MAP) s = s.replace(p, r);
  return s;
}

// ─── Markdown → HTML ──────────────────────────────────────────────────────────
// Ported from questionRenderer.js applyMarkdown()

function applyMarkdown(html) {
  html = html.replace(/\\\*\\\*(.+?)\\\*\\\*/gs, '<strong>$1</strong>');
  html = html.replace(/\*\*(.+?)\*\*/gs,          '<strong>$1</strong>');
  html = html.replace(/\\\*(.+?)\\\*/gs,           '<em>$1</em>');
  html = html.replace(/\*([^*]+?)\*/gs,            '<em>$1</em>');
  html = html.replace(/\^\(([^)]+?)\)/g,           '<sup>$1</sup>');
  html = html.replace(/_\(([^)]+?)\)/g,            '<sub>$1</sub>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ─── Core inline text processor ───────────────────────────────────────────────
// Ported verbatim from questionRenderer.js processInlineText()

function processInlineText(text) {
  if (!text) return '';
  let s = String(text);

  // (b) Convert $ / $$ to explicit delimiters
  s = convertDollarMath(s);

  // (c) Single-pass extraction: explicit \(...\) / \[...\] + bare LaTeX
  const { out, tokens: mathTokens } = extractMathTokens(s);
  s = out;

  // (c.1) Strip orphan \) and \] — unmatched closers
  s = s.replace(/\\([)\]])/g, '$1');

  // (d) Prose LaTeX fallback → Unicode
  s = applyProseLatexMap(s);

  // (e) HTML-escape remaining plain text
  s = escapeHtml(s);

  // (f) Apply markdown (**bold**, *italic*, ^(sup), _(sub))
  s = applyMarkdown(s);

  // (g) Restore math tokens → KaTeX HTML
  s = s.replace(
    new RegExp(`${MATH_PLACEHOLDER}(\\d+)${MATH_PLACEHOLDER}`, 'g'),
    (_, idx) => {
      const tok = mathTokens[+idx];
      return tok ? renderKatex(tok.latex, tok.display) : '';
    }
  );

  return s;
}

// ─── Main paragraph-splitting renderer ───────────────────────────────────────
// Ported from questionRenderer.js renderTablesListsImages()

function renderContent(md) {
  if (!md) return '';
  let s = String(md);

  // Pre-pass: \( \[...\] \) → \[...\]
  s = s.replace(/\\\(\s*\\\[([\s\S]*?)\\\]\s*\\\)/g, '\\[$1\\]');

  // Pre-pass: Fix malformed closers \\) \\] → \) \]
  s = s.replace(/\\\\([)\]])/g, '\\$1');

  // Pre-pass: auto-close \(...\) blocks that mix LaTeX and English prose
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (match, content) => {
    if (content.length < 80 || content.includes('\\(')) return match;
    const boundary = content.match(/^([\s\S]*?\})\s+([A-Z][a-z]{3,}\s[\s\S]{20,})$/);
    if (boundary) return `\\(${boundary[1].trim()}\\) ${boundary[2]}`;
    return match;
  });

  const coalesced = coalesceMathBlocks(s);
  const paragraphs = coalesced.split(/\n\n+/);

  return paragraphs.map(para => {
    const t = para.trim();
    if (!t) return '';
    return `<p>${processInlineText(para)}</p>`;
  }).join('\n');
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * renderMath(text) → HTML string
 *
 * Full pipeline for any question/option/explanation string.
 * Handles \(...\), \[...\], $$..$$, $...$, bare LaTeX commands,
 * HTML entities, prose LaTeX → Unicode, **bold**, ^(sup), _(sub).
 */
function renderMath(text) {
  if (!text) return '';
  // Decode outer HTML entities first (e.g. &lt; in content that wasn't in math)
  const decoded = decodeHtmlEntities(String(text));
  return renderContent(decoded);
}

/**
 * renderInlineMath(text) — like renderMath but strips the outer <p> wrapper
 * for single-paragraph content. Used for option text so the label (A.) and
 * content stay on the same flex row without the block <p> breaking the layout.
 */
function renderInlineMath(text) {
  const html = renderMath(text);
  if (!html) return '';
  // If the result is a single <p>...</p> (no sibling paragraphs), strip the tags
  const trimmed = html.trim();
  const singleP = trimmed.match(/^<p>([ -￿]*?)<\/p>$/);
  return singleP ? singleP[1] : html;
}

// ─── Table renderer ───────────────────────────────────────────────────────────

/**
 * Render a table object { rows: [[cell, ...], ...] } to an HTML table string.
 * Each cell is either a plain markdown string or a rich object
 * { md, rowspan?, colspan?, header? }.
 */
function renderTableObj(tableObj) {
  if (!tableObj || !tableObj.rows) return '';
  const rows = tableObj.rows.map(row => {
    const cells = row.map(cell => {
      let md, attrs = '', tag = 'td';
      if (typeof cell === 'string') {
        md = cell;
      } else {
        md   = cell.md || '';
        if (cell.rowspan && cell.rowspan !== 1) attrs += ` rowspan="${cell.rowspan}"`;
        if (cell.colspan && cell.colspan !== 1) attrs += ` colspan="${cell.colspan}"`;
        if (cell.header) tag = 'th';
      }
      return `<${tag}${attrs}>${renderMath(md)}</${tag}>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="q-table-wrap"><table class="q-table">${rows}</table></div>`;
}

/**
 * Render a list object { ordered: bool, items: [md, ...] } to HTML.
 */
function renderListObj(listObj) {
  if (!listObj || !listObj.items) return '';
  const tag = listObj.ordered ? 'ol' : 'ul';
  const items = listObj.items.map(item => `<li>${renderMath(item)}</li>`).join('');
  return `<${tag} class="q-list">${items}</${tag}>`;
}

/**
 * Render a rich content field that may include {{table:N}}, {{image:N}},
 * {{list:N}} placeholders, replacing them with HTML using the sibling arrays.
 *
 * @param {string}   md      — markdown string (possibly with placeholders)
 * @param {object}   sibling — the parent object that may have _tables/_images/_lists
 * @param {string}   prefix  — key prefix, e.g. "content" or "text"
 */
function renderRichMath(md, sibling, prefix) {
  if (!md) return '';
  const tables = sibling[`${prefix}_tables`] || [];
  const images = sibling[`${prefix}_images`] || [];
  const lists  = sibling[`${prefix}_lists`]  || [];

  // First render the markdown text (math, bold, etc.)
  let html = renderMath(md);

  // Replace {{table:N}} placeholders
  html = html.replace(/\{\{table:(\d+)\}\}/g, (_, idx) => {
    const t = tables[+idx];
    return t ? renderTableObj(t) : '';
  });

  // Replace {{image:N}} placeholders
  html = html.replace(/\{\{image:(\d+)\}\}/g, (_, idx) => {
    const img = images[+idx];
    if (!img || !img.url) return '';
    const alt = escapeHtml(img.alt || '');
    return `<img class="q-img" src="${escapeHtml(img.url)}" alt="${alt}">`;
  });

  // Replace {{list:N}} placeholders
  html = html.replace(/\{\{list:(\d+)\}\}/g, (_, idx) => {
    const l = lists[+idx];
    return l ? renderListObj(l) : '';
  });

  return html;
}

/**
 * Render a content field from the cleaned question object.
 * Handles both the old format (plain string) and the new compact format
 * (string with {{table:N}} placeholders + sibling _tables/_images/_lists arrays).
 *
 * @param {object} enObj   — the language body object (e.g. q.question.en)
 * @param {string} fieldKey — "content" or "answer" etc.
 */
function renderField(enObj, fieldKey) {
  const val = enObj[fieldKey];
  if (!val) return '';
  return renderRichMath(val, enObj, fieldKey);
}

/**
 * Render an option's content — plain string or rich object
 * { text, text_tables, text_images, text_lists }.
 */
function renderOptionContent(opt) {
  const c = opt.content;
  if (!c) return '';
  // Use renderInlineMath for plain strings so the <p> wrapper
  // doesn't break the flex row with the option letter label.
  if (typeof c === 'string') return renderInlineMath(c);
  // Rich object (may contain images/tables — can't be stripped, use full render)
  return renderRichMath(c.text || '', c, 'text');
}

// ─── Question-type resolver ───────────────────────────────────────────────────

/**
 * resolveQuestionType(questionType) → internal type string
 *
 * Maps the new JSON format's questionType values to the internal type
 * identifiers used throughout the app ('mcq', 'integer', etc.).
 */
function resolveQuestionType(questionType) {
  const map = {
    'single-select': 'mcq',
    'multi-select':  'mcqm',
    'integer':       'integer',
    'numerical':     'integer',
    'subjective':    'subjective',
    'fill-blanks':   'fill-blanks',
  };
  return map[questionType] || questionType || 'mcq';
}


// ─── HTML+Math renderer (new question format) ─────────────────────────────────────────────────

/**
 * preprocessMathDelimiters(html)
 *
 * Normalises known delimiter encoding quirks in question_formate2.json BEFORE
 * the HTML is parsed into DOM and handed to renderMathInElement.
 *
 * Problems fixed:
 *
 * 1. Triple-dollar delimiters  $$$...$$$
 *    Some explanations wrap a multi-line formula in $$$...$$$  (three dollar
 *    signs).  renderMathInElement sees $$ + $content$ + $$ where opening pair
 *    immediately closes on the third $, leaving "$content$" as an orphaned
 *    inline-math attempt.  The stray leading $ in "$ formula" causes a KaTeX
 *    parse error, and with throwOnError:false the raw LaTeX (including the $)
 *    is injected as red error text — exactly what the user saw.
 *    Fix: $$$ or more on each side → exactly $$.
 *
 * 2. \mathrm{~Pa} / \text{~...} tilde prefix
 *    Physics notation uses ~ (non-breaking space in LaTeX text mode) before
 *    unit abbreviations inside \mathrm{}.  Strip the leading ~ so
 *    \mathrm{~Pa} → \mathrm{Pa}.
 */
function preprocessMathDelimiters(html) {
  let s = String(html);

  // Fix 1: $$$...$$$  (3 or more $ on EACH side) → $$...$$
  var tripleRe = new RegExp('\\${3,}([\\s\\S]*?)\\${3,}', 'g');
  s = s.replace(tripleRe, function(_, content) { return '$$' + content + '$$'; });

  // Fix 2: \mathrm{~x}  →  \mathrm{x}   (and same for \text{~x})
  s = s.replace(/\\(mathrm|text)\{~([^}]*)\}/g, '\\$1{$2}');

  // Fix 3: Double-encoded backslash commands  \\cmd → \cmd
  // Many explanations in question_formate2.json have double-escaped LaTeX
  // (stored as \\\\text, \\\\frac in raw JSON = \\text, \\frac in JS string).
  // KaTeX receives \\text and misinterprets \\ as a LaTeX row-break command,
  // causing a parse error and showing raw LaTeX.
  //
  // Rule: \\CMD (double-backslash + 2+ letter command) → \CMD.
  // Restricted to 2+ letter names so that matrix row-breaks like \\d (row
  // Fix 3 (updated 2-pass): Double-escaped named LaTeX commands (2+ letters)
  // from older OCR/conversion pipelines.  e.g. \\frac → \frac.
  // !! Only match 2+ letter commands to avoid mangling matrix row-breaks like
  //    \\d (= \\ newline + d) or \\g.
  s = s.replace(/\\\\([a-zA-Z]{2,})/g, '\\$1');

  // Same for \\; \\, \\! \\: (spacing commands written with double backslash).
  s = s.replace(/\\\\([;,!:])/g, '\\$1');
  // Fix 3c: After Fix3a reduces \\\\cmd → \\cmd (TWO \ → ONE \), the sequence \\\\end{
  // (originally \\\\\\end = row-sep \\\\ + \\end env-close) becomes \\\\end{ (TWO \\).
  // KaTeX sees \\\\end{array} as \\\\ (row-sep) + end{array} (literal), never closing the env.
  // Fix: \\\\end{ (two \\) → \\end{ (one \\) — restores the proper \\end{...} command.
  s = s.replace(/\\\\end\{/g, '\\end{');

  // Fix 11: \begin{equation} or \begin{equation*} nested inside $$ is
  // redundant and causes KaTeX to error (can't nest display environments).
  // Strip the env wrapper, keeping the inner formula content.
  // e.g.  $$ \begin{equation*} f(x) \tag{i} \end{equation*} $$
  //      →  $$ f(x) \tag{i} $$
  s = s.replace(
    /\$\$\s*\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}\s*\$\$/g,
    function(_, inner) { return '$$' + inner.trim() + '$$'; }
  ); // \\; → \; (spacing)


  // Fix 4: Mismatched $$...$  ->  $$...$$
  // Some formulas close with a single $ instead of $$ (e.g. $$det(A)=0.$).
  // KaTeX auto-render cannot match these; normalize the closing delimiter.
  // Pattern: $$ formula_content $ (display math with single-dollar closer)  →  $$ formula_content $$
  // Content rules (avoids absorbing adjacent inline $..$ delimiters):
  //   • [^$<>]{3,}? — at least 3 chars, no bare $, no HTML tag chars
  //   • Minimum 3-char guard prevents matching a lone space before an inline $
  var fix4Re = new RegExp('\\$\\$([^$<>]{3,}?)\\$(?!\\$)', 'g');
  s = s.replace(fix4Re, function(_, content) { return '$$' + content + '$$'; });

  // Fix 5 / Fix 9 / Fix 12: Spacing command followed by optional whitespace then ^ or _.
  // e.g.  \,^{\circ}\text{C}    — ^ after spacing cmd (no space)
  //        \text{S}\!_\text{N}2  — _ after spacing cmd (no space)
  //        \, ^nC_{k-1}           — ^ after spacing cmd WITH a space (Fix 12)
  // KaTeX requires an explicit base atom before ^ or _.  Insert an empty {}.
  // \,\s*^  → \,{}^    \,\s*_  → \,{}_
  s = s.replace(/\\([,;:!])\s*\^/g, '\\$1{}^');
  s = s.replace(/\\([,;:!])\s*_/g,  '\\$1{}_');

  // Fix 6: Backslash-space  "\ "  outside $$...$$ is LaTeX typography for a
  // normal word space after abbreviations (e.g. "e.g.\ alumina").
  // In HTML it renders as a literal backslash, confusing readers.
  // IMPORTANT: Only replace SINGLE \  — i.e. NOT when preceded by another \.
  // "e.g.\ alumina" → safe to replace (. before \).
  // "\\ \hline"    → must NOT be touched (\\ is the LaTeX row-break; the second
  //                  \ before the space must stay).
  // The negative lookbehind (?<!\\) ensures we only replace an isolated \  .
  s = s.replace(/(?<!\\)\\ /g, ' ');

  // Fix 7: Unicode middle-dot U+00B7 (·) inside \text{...} is not in KaTeX's
  // supported text-mode character table and causes a rendering failure.
  // Split the text atom and insert the math-mode \cdot command instead.
  // e.g.  \text{Pa·s}  →  \text{Pa}\cdot\text{s}
  // Run twice to handle at most two · per \text{} argument.
  for (var _i = 0; _i < 2; _i++) {
    s = s.replace(/\\text\{([^}]*)\u00B7([^}]*)\}/g, '\\text{$1}\\cdot\\text{$2}');
  }

  // Fix 8: \* is not a valid KaTeX command and causes formula rendering to fail.
  // In LaTeX \* is a discretionary multiplication sign; in practice it is used
  // as a superscript marker (e.g. \sigma_{1s}^{\*}) where bare * suffices.
  // Replace globally — outside math it simply removes the spurious backslash.
  s = s.replace(/\\\*/g, '*');

  // Fix 13: \\& (LaTeX escaped ampersand) → &
  // In LaTeX text mode \\& produces a literal & character.
  // In HTML context the backslash is rendered as-is, showing "\\&" to the reader.
  // KaTeX math mode supports \\& as a literal & in cell content, which equals & anyway.
  // Safe to replace globally: in array/aligned environments & (unescaped) is the
  // column separator — same visual result as replacing \\& → & there too.
  s = s.replace(/\\&/g, '&');

  // Fix 14: \tag{...} is only valid in KaTeX display-mode math.
  // renderHtmlContent uses $$ with display:false (inline), so \tag causes
  // "KaTeX parse error: \tag is not allowed in inline math mode".
  // \tag is purely cosmetic equation numbering; strip it globally.
  s = s.replace(/\\tag\s*\{[^}]*\}/g, '');


  // Fix 15: \begin{array} with only | separators in column spec (e.g. {||}) is invalid LaTeX.
  // KaTeX throws a parse error because | specifies column rules, not column types.
  // Common in piecewise functions where {||} was used instead of {ll} (two left columns).
  // Replace any all-pipes column spec with {ll} (2 left-aligned columns).
  s = s.replace(/\\begin\{array\}\{\|+\}/g, '\\begin{array}{ll}');

  // Fix 16: $$...$$ blocks containing display-only environments (\begin{array}, \begin{cases}, etc.)
  // fail in KaTeX inline mode (display:false). Convert them to \[...\] for display:true rendering.
  // Uses negative lookahead (?!\$\$) to prevent matching across separate $$...$$ blocks.
  s = s.replace(/\$\$((?:(?!\$\$)[\s\S])*?\\begin\{(?:array|cases|pmatrix|bmatrix|vmatrix|matrix|aligned|align|gather)[^}]*\}(?:(?!\$\$)[\s\S])*?)\$\$/g, function(_, inner) { return '\\[' + inner + '\\]'; });
  return s;
}

/**
 * renderHtmlContent(html) — renders KaTeX math inside an HTML string.
 *
 * WHY DOM-BASED (not regex):
 *   The previous regex approach used /\$\$([\s\S]*?)\$\$/g which can cross
 *   HTML tag boundaries.  When an explanation contains $$...$<\/p><p>...$$
 *   the regex captures the HTML tags as LaTeX, KaTeX fails, and the raw
 *   error string (including "<\/p> <p>") is injected into the output.
 *
 *   KaTeX's own renderMathInElement() walks DOM *text nodes*, making it
 *   physically impossible to cross an HTML tag boundary.  It is the correct,
 *   officially supported tool for rendering math inside HTML content.
 *
 * Delimiters handled (in priority order by KaTeX auto-render):
 *   \[...\]   — display math  (explicit block LaTeX)
 *   \(...\)   — inline math   (explicit inline LaTeX)
 *   $$...$$   — inline math   (used in prose; <p> provides visual separation)
 *   $...$     — inline math
 */
function renderHtmlContent(html) {
  if (!html) return '';

  // Normalise known delimiter issues before DOM parsing
  const cleaned = preprocessMathDelimiters(String(html));

  // Build a temporary DOM node so renderMathInElement can walk text nodes
  const div = document.createElement('div');
  div.innerHTML = cleaned;

  if (typeof renderMathInElement === 'function') {
    renderMathInElement(div, {
      delimiters: [
        // Explicit LaTeX block/inline — highest priority
        { left: '\\[', right: '\\]', display: true  },
        { left: '\\(', right: '\\)', display: false },
        // $$ used inline in prose (e.g. "Let $$\alpha,\beta$$ be roots...")
        // display:false keeps it in the text flow; <p> provides block separation.
        { left: '$$', right: '$$', display: false },
        // Single $ inline
        { left: '$',  right: '$',  display: false },
      ],
      throwOnError: false,      // render error in red instead of throwing
      errorColor:   '#cc0000',
    });
  }

  return div.innerHTML;
}

