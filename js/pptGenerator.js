/**
 * pptGenerator.js — Question Deck PPT builder
 *
 * Updated for question_formate2.json schema.
 * Depends on: mathUtils.js (renderHtmlContent, resolveQuestionType, escapeHtml)
 *
 * Image CORS strategy (fetchImageAsDataUrl):
 *   0. Canvas draw    — instant if browser already cached the image (no proxy)
 *   1. corsproxy.io   — adds CORS headers; free, no auth needed
 *   2. allorigins.win — secondary free proxy
 *   If all fail → minimal placeholder so slide generation never crashes.
 *
 * Options layout fix:
 *   inlineOptionHtml() strips <p> wrappers from option content so the option
 *   letter and its value stay on the same horizontal line (flex row).
 */

// ─── CDN URLs ─────────────────────────────────────────────────────────────────
const CDN_PPTXGENJS  = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
const CDN_DOMTOIMAGE = 'https://cdn.jsdelivr.net/npm/dom-to-image-more@3.4.0/dist/dom-to-image-more.min.js';

// ─── Themes ───────────────────────────────────────────────────────────────────
const PPT_THEMES = {
  dark:  { bg: '303030', bgCss: '#303030', textColor: '#FFFFFF', mutedColor: '#AAAAAA' },
  light: { bg: 'FFFFFF', bgCss: '#FFFFFF', textColor: '#14212b', mutedColor: '#787878' },
};

// ─── Lazy script loader ───────────────────────────────────────────────────────
const _loaded = {};
function loadScript(src) {
  if (_loaded[src]) return _loaded[src];
  _loaded[src] = new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
  return _loaded[src];
}

async function ensureDeps() {
  await Promise.all([loadScript(CDN_PPTXGENJS), loadScript(CDN_DOMTOIMAGE)]);
}

// ─── Strip <p> from option content ───────────────────────────────────────────
// Renders math and strips block-level <p> tags so option letter + value stay
// on the same line inside the flex row.
function inlineOptionHtml(rawContent) {
  const html = renderHtmlContent(String(rawContent || ''));
  return html.replace(/<p\b[^>]*>/gi, '').replace(/<\/p>/gi, ' ');
}

// ─── Detect short options → 2-column layout ───────────────────────────────────
function areOptionsShort(options) {
  if (!options || !options.length) return false;
  return options.every(opt => {
    const raw  = String(opt.content || '');
    const text = raw
      .replace(/<[^>]+>/g, '')
      .replace(/\$\$/g, '').replace(/\$/g, '')
      .replace(/\\[a-zA-Z]+/g, 'x')
      .trim();
    return text.length <= 60 && !raw.includes('<img');
  });
}

// ─── CORS-safe image converter ────────────────────────────────────────────────
// ─── Image loading primitives ─────────────────────────────────────────────────

/**
 * Load an image URL into a canvas and return a base64 PNG data-URI.
 * Requires the image (or its proxy URL) to send CORS headers.
 * Returns null on any failure (timeout, tainted canvas, network error).
 */
function imageViaCanvas(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas');
        c.width  = img.naturalWidth  || 1;
        c.height = img.naturalHeight || 1;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.toDataURL('image/png');
        resolve(d && d.length > 200 ? d : null);
      } catch (_) { resolve(null); }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

/**
 * Fetch a URL → blob → base64 data-URI.
 * The URL should already be a proxy URL that adds CORS headers.
 * Returns null on any failure.
 */
async function fetchBlobAsDataUrl(proxyUrl) {
  try {
    const resp = await fetch(proxyUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob || blob.size === 0) return null;
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const d = reader.result;
        res(d && d.length > 200 ? d : null);
      };
      reader.onerror = () => res(null);
      reader.readAsDataURL(blob);
    });
  } catch (_) { return null; }
}

/**
 * Convert an external image URL to a base64 data-URI using a cascade of
 * strategies.  Returns the data-URI string on success, or null.
 *
 * Strategy 1 — Direct canvas (crossOrigin=anonymous)
 *   Fast — zero extra network hops.  Works for servers that send CORS headers
 *   (e.g. examgoal CDN).  Will silently fail for cracku.in etc.
 *
 * Strategy 2 — wsrv.nl image proxy  (https://wsrv.nl)
 *   Dedicated image-CDN proxy, free, no auth, sends Access-Control-Allow-Origin:*.
 *   Specifically designed for cross-domain image serving — the right tool for
 *   cracku.in images that lack CORS headers on the origin server.
 *
 * Strategy 3 — corsproxy.io general proxy
 *   Fallback for non-image assets or if wsrv.nl is unavailable.
 *
 * allorigins.win is intentionally NOT used — it returns HTTP 401 for many
 * image hosting domains (including cracku.in).
 */
async function fetchImageAsDataUrl(src) {
  if (!src || src.startsWith('data:')) return src;

  // 1. Direct canvas — zero-cost if server supports CORS
  const direct = await imageViaCanvas(src);
  if (direct) return direct;

  // 2. wsrv.nl — dedicated image proxy, best choice for cracku.in / examgoal
  //    URL format: https://wsrv.nl/?url=<full-encoded-url>&output=png
  const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(src)}&output=png`;
  const wsrv = await imageViaCanvas(wsrvUrl);
  if (wsrv) return wsrv;

  // wsrv might fail if the image type is unsupported — try fetching the raw
  // proxy URL as a blob (covers edge cases like svg, webp, etc.)
  const wsrvBlob = await fetchBlobAsDataUrl(wsrvUrl);
  if (wsrvBlob) return wsrvBlob;

  // 3. corsproxy.io — general CORS proxy fallback
  const corsproxy = await fetchBlobAsDataUrl(`https://corsproxy.io/?url=${encodeURIComponent(src)}`);
  if (corsproxy) return corsproxy;

  return null; // all strategies exhausted
}

// ─── Pre-load all images in a container before dom-to-image capture ──────────
/**
 * Walk every <img> in the container and replace its src with a base64 data-URI
 * so dom-to-image can embed it without running into CORS restrictions itself.
 * Images that can't be loaded via any strategy are replaced with a grey
 * placeholder <div> so slide generation never crashes.
 */
async function preloadImagesForCapture(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(imgs.map(async img => {
    const src = img.src;
    if (!src || src.startsWith('data:')) return; // already inline

    const dataUrl = await fetchImageAsDataUrl(src);
    if (dataUrl) {
      img.src = dataUrl;
      img.removeAttribute('crossorigin'); // clean up — no longer needed
    } else {
      const ph = document.createElement('div');
      ph.style.cssText = [
        'display:inline-flex;align-items:center;justify-content:center;',
        'background:#3a3a3a;border:1px dashed #666;border-radius:4px;',
        'padding:10px 18px;color:#888;font-size:13px;',
        'font-family:Arial,sans-serif;font-style:italic;',
        'min-width:80px;min-height:40px;',
      ].join('');
      ph.textContent = '[ Image ]';
      img.parentNode?.replaceChild(ph, img);
    }
  }));
}

// ─── Render a single question to HTML for PPT capture ────────────────────────
function renderQuestionHtml(q, idx, theme) {
  const content     = q.question_text || '';
  const optionsObj  = q.options || {};
  const optionsArr  = Object.entries(optionsObj).map(([id, val]) => ({
    identifier: id,
    content: String(val || ''),
  }));
  const correctAnswer = q.correct_answer;
  const qType         = resolveQuestionType(q.questionType);
  const short         = areOptionsShort(optionsArr);

  // Options grid
  const optGridStyle = short
    ? 'display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:12px;'
    : 'display:grid;grid-template-columns:1fr;gap:4px;margin-top:12px;';

  const optionsHtml = optionsArr.length
    ? `<div style="${optGridStyle}">` +
      optionsArr.map(opt => {
        const isCorrect = Array.isArray(correctAnswer)
          ? correctAnswer.includes(opt.identifier)
          : String(correctAnswer) === String(opt.identifier);
        const letterColor  = isCorrect ? '#22c55e' : theme.textColor;
        const letterWeight = isCorrect ? '900' : '700';
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
                      border-top:1px solid ${theme.mutedColor}33;">
            <span style="font-weight:${letterWeight};min-width:28px;flex-shrink:0;
                         color:${letterColor};font-family:Arial,sans-serif;">
              ${escapeHtml(opt.identifier)}.
            </span>
            <div style="flex:1;min-width:0;color:${theme.textColor};">
              ${inlineOptionHtml(opt.content)}
            </div>
          </div>`;
      }).join('') + `</div>`
    : '';

  // Answer badge (integer / numerical questions)
  const ANSWER_TYPES = ['integer', 'numerical', 'subjective', 'fill-blanks'];
  const showAnswer = ANSWER_TYPES.includes(qType)
    && correctAnswer !== undefined && correctAnswer !== null && correctAnswer !== '';
  const answerHtml = showAnswer
    ? `<div style="margin-top:12px;display:flex;align-items:center;gap:8px;">
         <span style="color:#22c55e;font-weight:700;font-family:Arial,sans-serif;font-size:1.1rem;">Ans:</span>
         <span style="color:${theme.textColor};font-size:1.2rem;">${escapeHtml(String(correctAnswer))}</span>
       </div>`
    : '';

  // Source badge
  const sourceHtml = q.paperTitle
    ? `<div style="font-size:14px;color:${theme.mutedColor};font-style:italic;
                   margin-bottom:8px;font-family:Arial,sans-serif;">
         ${escapeHtml(q.paperTitle)} · ${escapeHtml(String(q.year || ''))}
       </div>`
    : '';

  return `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="font-weight:700;font-size:1.6rem;min-width:38px;flex-shrink:0;
                  color:${theme.textColor};font-family:Georgia,serif;">
        ${idx + 1}.
      </div>
      <div style="flex:1;min-width:0;color:${theme.textColor};">
        ${sourceHtml}
        <div style="font-size:1.3rem;line-height:1.65;">
          ${renderHtmlContent(content)}
        </div>
        ${optionsHtml}
        ${answerHtml}
      </div>
    </div>
  `;
}

// ─── Main PPT generation ──────────────────────────────────────────────────────
/**
 * @param {Array}    questions   — selected question objects
 * @param {string}   themeKey   — 'dark' | 'light'
 * @param {Function} onProgress — optional (current, total, status) => void
 */
async function generatePpt(questions, themeKey = 'dark', onProgress = null) {
  if (!questions || questions.length === 0) {
    alert('No questions selected.'); return;
  }
  const theme = PPT_THEMES[themeKey];
  if (!theme) throw new Error(`Unknown theme: ${themeKey}`);

  onProgress?.(0, questions.length, 'Loading libraries...');
  await ensureDeps();

  // Off-screen container — fixed at top:0 so KaTeX layout is correct
  const renderDiv = document.createElement('div');
  renderDiv.style.cssText = `
    position:fixed; top:0; left:-1300px;
    width:1100px; padding:18px 24px;
    background:${theme.bgCss};
    font-size:22px; line-height:1.6;
    overflow:visible;
    font-family:Georgia,'Times New Roman',serif;
  `;
  document.body.appendChild(renderDiv);

  try {
    const pres = new window.PptxGenJS();
    pres.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
    pres.layout = 'WIDE';

    for (let i = 0; i < questions.length; i++) {
      onProgress?.(i + 1, questions.length, `Slide ${i + 1} / ${questions.length}...`);

      renderDiv.innerHTML = renderQuestionHtml(questions[i], i, theme);

      // Tint KaTeX math to match theme color
      renderDiv.querySelectorAll('.katex, .katex *').forEach(el => {
        el.style.color = theme.textColor;
      });
      renderDiv.querySelectorAll('p, li, span').forEach(el => {
        if (!el.style.color) el.style.color = theme.textColor;
      });

      // Convert external images → base64 (CORS proxy chain)
      await preloadImagesForCapture(renderDiv);

      // Two rAF passes for layout to settle after image replacements
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // 2× scale capture for crisp text
      const scale    = 2;
      const naturalW = renderDiv.offsetWidth;
      const naturalH = renderDiv.offsetHeight;

      const imgData = await window.domtoimage.toPng(renderDiv, {
        width:  naturalW * scale,
        height: naturalH * scale,
        style: {
          transform:       `scale(${scale})`,
          transformOrigin: 'top left',
          width:           `${naturalW}px`,
          height:          `${naturalH}px`,
        },
        bgcolor: theme.bgCss,
      });

      // Fit image to slide preserving aspect ratio
      const slideW = 13.33, slideH = 7.5, mX = 0.15, mY = 0.15;
      const maxW = slideW - mX * 2, maxH = slideH - mY * 2;
      const aspect = naturalW / (naturalH || 1);
      let w = maxW, h = w / aspect;
      if (h > maxH) { h = maxH; w = h * aspect; }

      const slide = pres.addSlide();
      slide.background = { color: theme.bg };
      slide.addImage({ data: imgData, x: mX, y: mY, w, h });
    }

    document.body.removeChild(renderDiv);
    onProgress?.(questions.length, questions.length, 'Saving...');
    const subject = questions[0]?.subject || 'questions';
    await pres.writeFile({ fileName: `${subject}_${themeKey}.pptx` });
    onProgress?.(questions.length, questions.length, 'Done!');

  } catch (err) {
    if (document.body.contains(renderDiv)) document.body.removeChild(renderDiv);
    throw err;
  }
}
