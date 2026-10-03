/**
 * pptModal.js
 *
 * Settings modals + Generator Bar for Question Deck.
 * Ported from:
 *   D:\pdf_to_latex\Question_Rendering\PdfSettingsModal.jsx
 *   D:\pdf_to_latex\Question_Rendering\PdfGeneratorBar.jsx
 *
 * Public API (called from app.js):
 *   PptModal.open(themeKey, defaultSubject)  — opens PPT settings modal
 *   PdfModal.open(mode, defaultSubject)      — opens PDF settings modal ('questions'|'answerkey')
 *   PptBar.show(state)                       — updates the sticky bottom bar
 *   PptBar.hide()                            — hides the sticky bottom bar
 */

// ─── Utilities ────────────────────────────────────────────────────────────────

function getTodayString() {
  const d = new Date();
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('-');
}

function inputStyle() {
  return `width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:5px;
          background:#fff;color:var(--ink);font:14px 'Trebuchet MS',sans-serif;
          outline:none;box-sizing:border-box;`;
}

function labelStyle() {
  return `display:block;font:700 11px/1 'Trebuchet MS',sans-serif;
          color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;`;
}

// ─── Generic Modal helper ─────────────────────────────────────────────────────

function makeModalOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;
  return overlay;
}

// ─── PPT Settings Modal ───────────────────────────────────────────────────────

const PptModal = (() => {
  let _overlay = null, _resolve = null;

  function build(themeKey) {
    const overlay = makeModalOverlay();
    const isDark = themeKey === 'dark';
    const themeAccent = isDark ? '#FFC828' : '#14212b';
    const themeLabel  = isDark ? '🌙 Dark PPT' : '☀️ Light PPT';
    const today = getTodayString();

    const card = document.createElement('div');
    card.style.cssText = `
      background:var(--paper);border:1px solid var(--line);border-radius:16px;
      padding:24px 28px;max-width:520px;width:100%;
      box-shadow:0 20px 60px rgba(0,0,0,0.25);max-height:90vh;overflow-y:auto;
    `;
    card.innerHTML = `
      <h2 style="font:700 18px/1.3 'Trebuchet MS',sans-serif;color:var(--ink);
                 margin:0 0 20px;display:flex;align-items:center;gap:8px;">
        <span style="color:${themeAccent};">●</span> ${themeLabel} Settings
      </h2>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="${labelStyle()}">Subject</label>
          <input id="ppt-subject" type="text" placeholder="e.g. Mathematics" style="${inputStyle()}">
        </div>
        <div>
          <label style="${labelStyle()}">Date</label>
          <input id="ppt-date" type="text" value="${today}" placeholder="DD-MM-YYYY" style="${inputStyle()}">
        </div>
      </div>

      <div style="margin-top:12px;">
        <label style="${labelStyle()}">Presentation Title</label>
        <input id="ppt-title" type="text" value="Question Deck" placeholder="e.g. JEE Practice Set" style="${inputStyle()}">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div>
          <label style="${labelStyle()}">Total Marks</label>
          <input id="ppt-marks" type="text" value="136" placeholder="e.g. 136" style="${inputStyle()}">
        </div>
        <div>
          <label style="${labelStyle()}">Duration</label>
          <input id="ppt-duration" type="text" value="3 Hours" placeholder="e.g. 3 Hours" style="${inputStyle()}">
        </div>
      </div>

      <div style="background:var(--wash);border:1px solid var(--line);border-radius:8px;
                  padding:10px 14px;font:12px/1.5 'Trebuchet MS',sans-serif;
                  color:var(--teal-dark);margin:16px 0;">
        💡 <strong>Tip:</strong> Each slide is rendered at 2× resolution for crisp math and text.
        Generation may take a few seconds per slide.
      </div>

      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="ppt-cancel" style="padding:10px 24px;border-radius:8px;
          border:1px solid var(--line);background:transparent;color:var(--muted);
          font:700 14px 'Trebuchet MS',sans-serif;cursor:pointer;">Cancel</button>
        <button id="ppt-generate" style="padding:10px 24px;border-radius:8px;border:none;
          background:var(--coral);color:#fff;font:700 14px 'Trebuchet MS',sans-serif;cursor:pointer;">
          Generate PPT
        </button>
      </div>
    `;

    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    card.querySelector('#ppt-cancel').addEventListener('click', () => close(null));
    card.querySelector('#ppt-generate').addEventListener('click', () => close({
      subject:  card.querySelector('#ppt-subject').value.trim() || 'questions',
      date:     card.querySelector('#ppt-date').value.trim(),
      title:    card.querySelector('#ppt-title').value.trim(),
      marks:    card.querySelector('#ppt-marks').value.trim(),
      duration: card.querySelector('#ppt-duration').value.trim(),
      themeKey,
    }));
    return overlay;
  }

  function close(result) {
    if (_overlay && document.body.contains(_overlay)) document.body.removeChild(_overlay);
    _overlay = null;
    if (_resolve) { _resolve(result); _resolve = null; }
  }

  function open(themeKey, defaultSubject = '') {
    return new Promise(resolve => {
      _resolve = resolve;
      _overlay = build(themeKey);
      document.body.appendChild(_overlay);
      const sub = _overlay.querySelector('#ppt-subject');
      if (sub && defaultSubject) sub.value = defaultSubject.charAt(0).toUpperCase() + defaultSubject.slice(1);
      sub?.focus();
    });
  }

  return { open };
})();

// ─── PDF Settings Modal ───────────────────────────────────────────────────────

const PdfModal = (() => {
  let _overlay = null, _resolve = null;

  function build(mode) {
    const overlay = makeModalOverlay();
    const isAK    = mode === 'answerkey';
    const today   = getTodayString();
    const label   = isAK ? '🔑 Answer Key PDF' : '📄 Questions PDF';
    const accent  = isAK ? '#059669' : '#4f46e5';

    const card = document.createElement('div');
    card.style.cssText = `
      background:var(--paper);border:1px solid var(--line);border-radius:16px;
      padding:24px 28px;max-width:520px;width:100%;
      box-shadow:0 20px 60px rgba(0,0,0,0.25);max-height:90vh;overflow-y:auto;
    `;
    card.innerHTML = `
      <h2 style="font:700 18px/1.3 'Trebuchet MS',sans-serif;color:var(--ink);
                 margin:0 0 20px;display:flex;align-items:center;gap:8px;">
        <span style="color:${accent};">●</span> ${label} Settings
      </h2>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="${labelStyle()}">Subject</label>
          <input id="pdf-subject" type="text" placeholder="e.g. Mathematics" style="${inputStyle()}">
        </div>
        <div>
          <label style="${labelStyle()}">Date</label>
          <input id="pdf-date" type="text" value="${today}" placeholder="DD-MM-YYYY" style="${inputStyle()}">
        </div>
      </div>

      <div style="margin-top:12px;">
        <label style="${labelStyle()}">Paper Title</label>
        <input id="pdf-title" type="text" value="IIT-JEE Practice Set" placeholder="e.g. JEE Practice Set" style="${inputStyle()}">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div>
          <label style="${labelStyle()}">Total Marks</label>
          <input id="pdf-marks" type="text" value="136" placeholder="e.g. 136" style="${inputStyle()}">
        </div>
        <div>
          <label style="${labelStyle()}">Duration</label>
          <input id="pdf-duration" type="text" value="3 Hours" placeholder="e.g. 3 Hours" style="${inputStyle()}">
        </div>
      </div>

      <div style="margin-top:12px;">
        <label style="${labelStyle()}">Section (optional)</label>
        <input id="pdf-section" type="text" placeholder="e.g. Section A" style="${inputStyle()}">
      </div>

      <label style="display:flex;align-items:center;gap:8px;margin:14px 0;
                    cursor:pointer;font:13px 'Trebuchet MS',sans-serif;color:var(--muted);">
        <input id="pdf-show-source" type="checkbox" checked
               style="width:16px;height:16px;cursor:pointer;accent-color:var(--teal);">
        Show paper source below each question
      </label>

      <div style="background:var(--wash);border:1px solid var(--line);border-radius:8px;
                  padding:10px 14px;font:12px/1.5 'Trebuchet MS',sans-serif;
                  color:var(--teal-dark);margin-bottom:20px;">
        💡 A browser Print dialog will open. Choose <strong>Save as PDF</strong> to download.
        ${isAK ? 'The answer key includes a grid table and solutions.' : 'Options are shown for each question.'}
      </div>

      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="pdf-cancel" style="padding:10px 24px;border-radius:8px;
          border:1px solid var(--line);background:transparent;color:var(--muted);
          font:700 14px 'Trebuchet MS',sans-serif;cursor:pointer;">Cancel</button>
        <button id="pdf-generate" style="padding:10px 24px;border-radius:8px;border:none;
          background:${accent};color:#fff;font:700 14px 'Trebuchet MS',sans-serif;cursor:pointer;">
          ${isAK ? 'Generate Answer Key PDF' : 'Generate Questions PDF'}
        </button>
      </div>
    `;

    overlay.appendChild(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    card.querySelector('#pdf-cancel').addEventListener('click', () => close(null));
    card.querySelector('#pdf-generate').addEventListener('click', () => close({
      subject:    card.querySelector('#pdf-subject').value.trim() || 'Questions',
      date:       card.querySelector('#pdf-date').value.trim(),
      title:      card.querySelector('#pdf-title').value.trim(),
      marks:      card.querySelector('#pdf-marks').value.trim(),
      duration:   card.querySelector('#pdf-duration').value.trim(),
      section:    card.querySelector('#pdf-section').value.trim(),
      showSource: card.querySelector('#pdf-show-source').checked,
      mode,
    }));
    return overlay;
  }

  function close(result) {
    if (_overlay && document.body.contains(_overlay)) document.body.removeChild(_overlay);
    _overlay = null;
    if (_resolve) { _resolve(result); _resolve = null; }
  }

  function open(mode = 'questions', defaultSubject = '') {
    return new Promise(resolve => {
      _resolve = resolve;
      _overlay = build(mode);
      document.body.appendChild(_overlay);
      const sub = _overlay.querySelector('#pdf-subject');
      if (sub && defaultSubject) sub.value = defaultSubject.charAt(0).toUpperCase() + defaultSubject.slice(1);
      sub?.focus();
    });
  }

  return { open };
})();

// ─── Generator Bar ────────────────────────────────────────────────────────────
// Sticky bottom bar — ported from PdfGeneratorBar.jsx

const PptBar = (() => {
  let _bar = null;

  function btnStyle(extra = '') {
    return `display:inline-flex;align-items:center;gap:5px;padding:7px 13px;
            border-radius:8px;font:700 12px 'Trebuchet MS',sans-serif;
            cursor:pointer;flex-shrink:0;white-space:nowrap;transition:opacity .2s;${extra}`;
  }

  function sep() {
    return `<span style="color:var(--line);font-size:18px;flex-shrink:0;">|</span>`;
  }

  function build() {
    const bar = document.createElement('div');
    bar.id = 'ppt-bar';
    bar.style.cssText = `
      position:fixed;bottom:0;left:0;right:0;z-index:200;
      background:var(--paper);border-top:2px solid var(--coral);
      box-shadow:0 -4px 24px rgba(0,0,0,0.12);padding:10px 16px;
      display:none;
    `;
    bar.innerHTML = `
      <div style="max-width:1120px;margin:0 auto;display:flex;align-items:center;
                  gap:9px;flex-wrap:wrap;">
        <span id="ppt-bar-count"
              style="font:700 13px 'Trebuchet MS',sans-serif;color:var(--coral);flex-shrink:0;">
          0 selected
        </span>

        <div style="flex:1;"></div>

        <span id="ppt-bar-progress"
              style="font:12px 'Trebuchet MS',sans-serif;color:var(--muted);
                     flex-shrink:0;display:none;">
          ⏳ Generating...
        </span>

        <!-- Questions PDF -->
        <button id="bar-btn-qpdf"
          style="${btnStyle('background:#4f46e5;color:#fff;border:none;')}">
          📄 Questions PDF
        </button>

        <!-- Answer Key PDF -->
        <button id="bar-btn-akpdf"
          style="${btnStyle('background:#059669;color:#fff;border:none;')}">
          🔑 Answer Key PDF
        </button>

        ${sep()}

        <!-- Dark PPT -->
        <button id="ppt-btn-dark"
          style="${btnStyle('background:#303030;color:#fff;border:1.5px solid #555;')}">
          🌙 Dark PPT
        </button>

        <!-- Light PPT -->
        <button id="ppt-btn-light"
          style="${btnStyle('background:#fff;color:#14212b;border:1.5px solid #14212b;')}">
          ☀️ Light PPT
        </button>
      </div>
    `;
    return bar;
  }

  function getBar() {
    if (!_bar) { _bar = build(); document.body.appendChild(_bar); }
    return _bar;
  }

  /**
   * @param {object} state — { selectedCount, busy, progressText, onDark, onLight, onQPdf, onAKPdf }
   */
  function show({ selectedCount = 0, busy = false, progressText = '',
                  onDark, onLight, onQPdf, onAKPdf }) {
    const bar = getBar();
    bar.style.display = 'block';

    bar.querySelector('#ppt-bar-count').textContent =
      `${selectedCount} question${selectedCount !== 1 ? 's' : ''} selected`;

    const progress = bar.querySelector('#ppt-bar-progress');
    progress.style.display = busy ? 'inline' : 'none';
    progress.textContent   = `⏳ ${progressText || 'Generating...'}`;

    const disabled = busy || selectedCount === 0;

    ['#bar-btn-qpdf','#bar-btn-akpdf','#ppt-btn-dark','#ppt-btn-light'].forEach(sel => {
      const btn = bar.querySelector(sel);
      btn.disabled       = disabled;
      btn.style.opacity  = disabled ? '0.45' : '1';
      btn.style.cursor   = disabled ? 'not-allowed' : 'pointer';
      const nb = btn.cloneNode(true);
      btn.replaceWith(nb);
      if (!disabled) {
        if (sel === '#bar-btn-qpdf')   nb.addEventListener('click', onQPdf);
        if (sel === '#bar-btn-akpdf')  nb.addEventListener('click', onAKPdf);
        if (sel === '#ppt-btn-dark')   nb.addEventListener('click', onDark);
        if (sel === '#ppt-btn-light')  nb.addEventListener('click', onLight);
      }
    });
  }

  function hide() {
    if (_bar) _bar.style.display = 'none';
  }

  return { show, hide };
})();
