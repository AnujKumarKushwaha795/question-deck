/**
 * pdfGenerator.js
 *
 * PDF generation for Question Deck.
 * Updated for question_formate2.json schema:
 *   - q.question_text  (HTML string with $$...$$ math)
 *   - q.options        ({A: "<p>...", ...} object — empty {} for integer type)
 *   - q.correct_answer (string "A"/"B"/... or number for integer)
 *   - q.questionType   ("single-select" | "integer")
 *   - q.explanations   ([{type, title, content?, url?}, ...])
 *   Uses renderHtmlContent() from mathUtils.js for all math rendering.
 *
 * Public API:
 *   generatePdf(questions, settings, mode)  — 'questions' | 'answerkey'
 */

// ─── Print container ──────────────────────────────────────────────────────────

const PRINT_CONTAINER_ID = 'am-print-container';

function getPrintContainer() {
  let el = document.getElementById(PRINT_CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PRINT_CONTAINER_ID;
    document.body.appendChild(el);
  }
  return el;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert question's options object to an array of {identifier, content}.
 * Handles both new format ({A: "<p>...</p>"}) and legacy array format.
 */
function optionsToArray(options) {
  if (!options) return [];
  if (Array.isArray(options)) return options; // legacy format compatibility
  return Object.entries(options).map(([id, val]) => ({
    identifier: id,
    content: String(val || ''),
  }));
}

/**
 * Detect short options — used to decide 1-column vs 2-column layout.
 * Strips HTML tags and math delimiters before measuring text length.
 */
function pdfOptionsShort(options) {
  if (!options || !options.length) return false;
  return options.every(opt => {
    if (!opt) return true;
    const raw  = String(opt.content || '');
    const text = raw
      .replace(/<[^>]+>/g, '')        // strip HTML tags
      .replace(/\$\$/g, '')           // strip $$
      .replace(/\$/g, '')             // strip $
      .replace(/\\[a-zA-Z]+/g, 'x')  // replace \command with single char
      .trim();
    return text.length <= 60 && !raw.includes('<img');
  });
}

/**
 * Get the answer string for display.
 * New format: q.correct_answer is a string (MCQ letter) or number (integer).
 */
function getAnswerString(q) {
  const answer = q.correct_answer;
  if (answer === undefined || answer === null || answer === '') return '—';
  return String(answer);
}

// ─── Paper header (shared by both modes) ─────────────────────────────────────

function buildHeader(container, settings, suffix = '') {
  const hdr = document.createElement('table');
  hdr.className = 'am-paper-header';
  hdr.innerHTML = `
    <tr>
      <td class="am-ph-left am-ph-bold">Subject : ${_esc(settings.subject)}</td>
      <td class="am-ph-center am-ph-bold">${_esc(settings.title)}${suffix ? ' \u2014 ' + suffix : ''}</td>
      <td class="am-ph-right">Date : ${_esc(settings.date)}</td>
    </tr>
    <tr>
      <td class="am-ph-left am-ph-bold">Total Marks : ${_esc(settings.marks)}</td>
      <td class="am-ph-center"></td>
      <td class="am-ph-right am-ph-bold">Duration : ${_esc(settings.duration)}</td>
    </tr>
  `;
  container.appendChild(hdr);
}

// ─── Questions PDF builder ────────────────────────────────────────────────────

function buildQuestionsContent(questions, settings) {
  const container = getPrintContainer();
  container.innerHTML = '';

  buildHeader(container, settings);

  if (settings.section) {
    const wrap = document.createElement('div');
    wrap.className = 'am-section-title-wrapper';
    wrap.innerHTML = `<span class="am-section-title">${_esc(settings.subject)} \u2014 ${_esc(settings.section)}</span>`;
    container.appendChild(wrap);
  }

  questions.forEach((q, idx) => {
    const options = optionsToArray(q.options);
    const short   = pdfOptionsShort(options);

    const qDiv = document.createElement('div');
    qDiv.className = 'am-print-question';

    const row = document.createElement('div');
    row.className = 'am-print-q-row';

    const num = document.createElement('div');
    num.className = 'am-print-q-number';
    num.textContent = `${idx + 1}.`;

    const body = document.createElement('div');
    body.className = 'am-print-q-body';

    // Question content — renderHtmlContent handles HTML + $$...$$ math
    const textDiv = document.createElement('div');
    textDiv.className = 'am-print-q-text';
    textDiv.innerHTML = renderHtmlContent(q.question_text || '');
    body.appendChild(textDiv);

    // Source line
    if (settings.showSource && q.paperTitle) {
      const src = document.createElement('div');
      src.className = 'am-print-paper-source';
      src.textContent = q.paperTitle;
      body.appendChild(src);
    }

    // Options
    if (options.length) {
      const ul = document.createElement('ul');
      ul.className = short ? 'am-print-options-inline' : 'am-print-options';

      options.forEach(opt => {
        const li = document.createElement('li');
        li.style.cssText = 'display:flex;align-items:flex-start;gap:6px;';

        const letter = document.createElement('span');
        letter.className = 'am-print-opt-letter';
        letter.style.cssText = 'flex-shrink:0;min-width:22px;';
        letter.textContent = `${opt.identifier || ''}.`;

        const text = document.createElement('div');
        text.style.cssText = 'flex:1;min-width:0;';
        // Strip <p> wrapper so option value stays inline with the letter label
        const optHtml = renderHtmlContent(String(opt.content || ''))
          .replace(/<p\b[^>]*>/gi, '').replace(/<\/p>/gi, ' ');
        text.innerHTML = optHtml;


        li.appendChild(letter);
        li.appendChild(text);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    row.appendChild(num);
    row.appendChild(body);
    qDiv.appendChild(row);
    container.appendChild(qDiv);
  });
}

// ─── Answer Key PDF builder ───────────────────────────────────────────────────

function buildAnswerKeyContent(questions, settings) {
  const container = getPrintContainer();
  container.innerHTML = '';

  buildHeader(container, settings, 'Answer Key');

  // Answer Key title bar
  const akWrap = document.createElement('div');
  akWrap.className = 'am-section-title-wrapper';
  akWrap.innerHTML = `<span class="am-section-title">Answer Key</span>`;
  container.appendChild(akWrap);

  // Answer grid table — 5 Q/A pairs per row (column-major fill)
  const cols   = 5;
  const totalQ = questions.length;
  const rows   = Math.ceil(totalQ / cols);

  const table = document.createElement('table');
  table.className = 'am-answer-key-table';

  let hdrRow = '<thead><tr>';
  for (let c = 0; c < cols; c++) hdrRow += '<th>Q. No.</th><th>Answer</th>';
  hdrRow += '</tr></thead>';
  table.innerHTML = hdrRow;

  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const idx = r + c * rows;
      const tdQ = document.createElement('td');
      const tdA = document.createElement('td');
      if (idx < totalQ) {
        const q   = questions[idx];
        const ans = getAnswerString(q);
        tdQ.textContent = String(idx + 1);
        tdA.textContent = ans;
      }
      tr.appendChild(tdQ);
      tr.appendChild(tdA);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // Solutions section header
  const solWrap = document.createElement('div');
  solWrap.className = 'am-print-solution-header-wrapper';
  solWrap.innerHTML = `<span class="am-print-solution-header">Solutions</span>`;
  container.appendChild(solWrap);

  // Individual solutions
  questions.forEach((q, idx) => {
    const ans = getAnswerString(q);

    const solDiv = document.createElement('div');
    solDiv.className = 'am-print-solution';

    const row = document.createElement('div');
    row.className = 'am-print-sol-row';

    const num = document.createElement('div');
    num.className = 'am-print-sol-number';
    num.textContent = `${idx + 1}.`;

    const body = document.createElement('div');
    body.className = 'am-print-sol-body';

    const ansDiv = document.createElement('div');
    ansDiv.className = 'am-print-sol-answer';
    ansDiv.textContent = `Answer: ${ans}`;
    body.appendChild(ansDiv);

    // Explanation — new format has q.explanations array
    // Pick the cleanest text explanation: skip ones with broken LaTeX structure.
    // Two types of broken explanations are detected:
    //   1. Broken matrix: \begin{env} isolated between $$...$$ pairs.
    //   2. Bare LaTeX: \frac, \sqrt, \times etc. appear outside $$...$$ blocks
    //      (content authored with LaTeX but math delimiters were stripped).
    // Falls back to the last text explanation if all fail both checks.
    const explanations = Array.isArray(q.explanations) ? q.explanations : [];
    const textExpl = (function pickBestExpl(expls) {
      const texts = expls.filter(e => e && e.type === 'text' && e.content);
      if (!texts.length) return null;
      for (const e of texts) {
        const c = e.content;
        // Check 1: \begin{env} is the ONLY content between $$..$$ (broken matrix)
        const hasBrokenMatrix = /\$\$\s*\\begin\{[^}]+\}\s*\$\$/.test(c);
        if (hasBrokenMatrix) continue;
        // Check 2: Bare LaTeX commands outside math delimiters.
        // Strip $$..$$ and $..$  blocks, then look for LaTeX command names.
        const plainText = c
          .replace(/\$\$[\s\S]*?\$\$/g, ' ')
          .replace(/\$[^$\n]+\$/g, ' ');
        // Use a general pattern: any \commandname (2+ letters) in plain text is bare LaTeX.
        // This catches \quad, \qquad, \hline, \Rightarrow, \frac, \sqrt, etc.
        const hasBareLatex = /\\[a-zA-Z]{2,}/.test(plainText);
        if (hasBareLatex) continue;
        // Check 3: HTML formatting tags (<em>, <strong>) splitting $$...$$ delimiters.
        // Occurs when Markdown processors convert LaTeX subscript _var_ to <em>var</em>
        // inside a formula, breaking the $$ pair.
        // Detect: $$ opener + LaTeX-like chars (no spaces/English) + an OPENING <em>/<strong> tag.
        // Using opening-only tags (<em>/<strong>, not </em>/</strong>) prevents false positives
        // when a formula CLOSES ($$) and is immediately followed by a section header end-tag
        // like $$L_1$$</strong>.
        const hasBrokenHtmlInMath = /\$\$[\w\[\]\\^{}_]*<(?:em|strong)[^>]*>/.test(c);
        if (hasBrokenHtmlInMath) continue;
        // Check 4: \ce{} is a mhchem (chemistry) macro — KaTeX requires the mhchem
        // extension to be loaded for it to render.  Since we only load the core
        // KaTeX + auto-render bundles, \ce{} causes "KaTeX parse error: \ce".
        // Skip any explanation that uses \ce{} so we fall through to a simpler one.
        const hasMhchem = /\\ce\{/.test(c);
        if (hasMhchem) continue;
        return e;   // clean — use it
      }
      return texts[texts.length - 1];  // all broken — use last as best effort
    })(explanations);
    const imgExpl  = explanations.find(e => e.type === 'image' && e.url);

    if (textExpl) {
      const contentDiv = document.createElement('div');
      contentDiv.className = 'am-print-sol-content';
      contentDiv.innerHTML = renderHtmlContent(textExpl.content);
      body.appendChild(contentDiv);
    } else if (imgExpl) {
      const contentDiv = document.createElement('div');
      contentDiv.className = 'am-print-sol-content';
      contentDiv.innerHTML = `<img src="${_esc(imgExpl.url)}" alt="Solution"
        style="max-width:100%;height:auto;display:block;margin:4px 0;">`;
      body.appendChild(contentDiv);
    } else {
      const noSol = document.createElement('div');
      noSol.className = 'am-print-sol-content';
      noSol.style.cssText = 'font-style:italic;color:#999;';
      noSol.textContent = 'Solution not available.';
      body.appendChild(noSol);
    }

    row.appendChild(num);
    row.appendChild(body);
    solDiv.appendChild(row);
    container.appendChild(solDiv);
  });
}

// ─── Public: generatePdf ─────────────────────────────────────────────────────

/**
 * Generate a PDF from selected questions.
 * @param {Array}  questions  — selected question objects (question_formate2.json)
 * @param {Object} settings   — { subject, title, date, marks, duration, section, showSource }
 * @param {string} mode       — 'questions' | 'answerkey'
 */
function generatePdf(questions, settings, mode = 'questions') {
  if (!questions || questions.length === 0) {
    alert('No questions selected.');
    return;
  }
  if (mode === 'answerkey') {
    buildAnswerKeyContent(questions, settings);
  } else {
    buildQuestionsContent(questions, settings);
  }
  // Brief delay so DOM renders before the print dialog
  setTimeout(() => window.print(), 250);
}
