// app.js — Question Deck  (Browse mode: Exams → Subjects → Chapters → Questions)
// Depends on (in load order): config.js, utils.js, mathUtils.js, questionApi.js,
//                              pdfGenerator.js, pptGenerator.js, pptModal.js

// --- State ------------------------------------------------------------------
const state = {
  questions:  [],
  selected:   new Set(),
  query:      '',
  pptBusy:    false,
  nav: {
    exam:    null,   // { id, name }
    subject: null,   // { id, name }
    chapter: null,   // { id, name }
  },
  cache: {
    exams:      null,
    subjects:   null,
    chapters:   null,
    topicIndex: null,
  },
};

const list  = document.querySelector('#questions');
const count = document.querySelector('#count');

// --- Name / subject helpers -------------------------------------------------
// slugToTitle(), displayName(), subjectMeta(), escapeHtml(), resolveQuestionType()
// are all provided by js/utils.js (loaded before this file in index.html).

// --- View switching ---------------------------------------------------------

function showView(id) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('view--active'); });
  document.getElementById('view-' + id).classList.add('view--active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Breadcrumb -------------------------------------------------------------

function updateBreadcrumb() {
  var bc = document.getElementById('breadcrumb');
  var nav = state.nav;

  var crumbs = [{ label: 'All Exams', view: 'exams' }];
  if (nav.exam)    crumbs.push({ label: displayName(nav.exam),    view: 'subjects' });
  if (nav.subject) crumbs.push({ label: displayName(nav.subject), view: 'chapters' });
  if (nav.chapter) crumbs.push({ label: displayName(nav.chapter), view: 'questions' });

  bc.innerHTML = crumbs.map(function(c, i) {
    var isLast = i === crumbs.length - 1;
    var sep = i > 0 ? '<span class="crumb-sep" aria-hidden="true">&rsaquo;</span>' : '';
    if (isLast) {
      return sep + '<span class="crumb crumb--active">' + escapeHtml(c.label) + '</span>';
    }
    return sep + '<button class="crumb" data-view="' + c.view + '" onclick="navBack(\'' + c.view + '\')">' + escapeHtml(c.label) + '</button>';
  }).join('');
}

function navBack(view) {
  if (view === 'exams') {
    state.nav = { exam: null, subject: null, chapter: null };
    state.questions = [];
    updateBreadcrumb();
    showView('exams');
  } else if (view === 'subjects') {
    state.nav.subject = null;
    state.nav.chapter = null;
    state.questions   = [];
    updateBreadcrumb();
    showView('subjects');
  } else if (view === 'chapters') {
    state.nav.chapter = null;
    state.questions   = [];
    updateBreadcrumb();
    showView('chapters');
  }
}

// --- Exam view --------------------------------------------------------------

async function renderExamsView() {
  var lead = document.getElementById('exams-lead');
  var grid = document.getElementById('exams-grid');

  lead.textContent = 'Loading...';
  grid.innerHTML   = '';

  var exams;
  try {
    exams = await QuestionApi.getExams();
    state.cache.exams = exams;
  } catch (err) {
    lead.textContent = 'Could not load exams: ' + err.message;
    return;
  }

  var papers = {};
  try { papers = await QuestionApi.getPapers(); } catch(e) {}

  var examList = Object.values(exams);
  lead.textContent = examList.length + ' exam' + (examList.length !== 1 ? 's' : '') + ' available';

  grid.innerHTML = examList.map(function(ex) {
    var examPapers = Object.values(papers).filter(function(p) { return p.exam === ex.id; });
    var totalQ     = examPapers.reduce(function(s, p) { return s + (p.questionCount || 0); }, 0);
    var name       = displayName(ex);
    return '<button class="card card--exam" onclick="selectExam(\'' + escapeHtml(ex.id) + '\')" aria-label="Browse ' + escapeHtml(name) + '">'
      + '<span class="card-icon">\uD83D\uDCDD</span>'
      + '<span class="card-name">' + escapeHtml(name) + '</span>'
      + '<span class="card-meta">' + examPapers.length + ' papers &middot; ' + totalQ.toLocaleString() + ' questions</span>'
      + '<span class="card-arrow">&rarr;</span>'
      + '</button>';
  }).join('');
}

async function selectExam(examId) {
  var exams = state.cache.exams || await QuestionApi.getExams();
  state.nav.exam    = exams[examId];
  state.nav.subject = null;
  state.nav.chapter = null;
  updateBreadcrumb();
  await renderSubjectsView();
  showView('subjects');
}

// --- Subjects view ----------------------------------------------------------

async function renderSubjectsView() {
  var lead = document.getElementById('subjects-lead');
  var grid = document.getElementById('subjects-grid');
  var exam = state.nav.exam;

  lead.textContent = 'Loading subjects...';
  grid.innerHTML   = '';

  var subjects;
  try {
    subjects = await QuestionApi.getSubjectsForExam(exam.id);
    state.cache.subjects = subjects;
  } catch (err) {
    lead.textContent = 'Could not load subjects: ' + err.message;
    return;
  }

  var subjList = Object.values(subjects);
  lead.textContent = escapeHtml(displayName(exam)) + ' -- ' + subjList.length + ' subject' + (subjList.length !== 1 ? 's' : '');

  grid.innerHTML = subjList.map(function(subj) {
    var meta    = subjectMeta(subj.id);
    var chCount = subj.chapters ? subj.chapters.length : 0;
    var name    = displayName(subj);
    return '<button class="card card--subject" onclick="selectSubject(\'' + escapeHtml(subj.id) + '\')"'
      + ' style="--subject-color:' + meta.color + '" aria-label="Browse ' + escapeHtml(name) + '">'
      + '<span class="card-icon">' + meta.icon + '</span>'
      + '<span class="card-name">' + escapeHtml(name) + '</span>'
      + '<span class="card-meta">' + chCount + ' chapter' + (chCount !== 1 ? 's' : '') + '</span>'
      + '<span class="card-arrow">&rarr;</span>'
      + '</button>';
  }).join('');
}

async function selectSubject(subjId) {
  var subjects = state.cache.subjects || await QuestionApi.getSubjectsForExam(state.nav.exam.id);
  state.nav.subject = subjects[subjId];
  state.nav.chapter = null;
  updateBreadcrumb();
  await renderChaptersView();
  showView('chapters');
}

// --- Chapters view ----------------------------------------------------------

async function renderChaptersView() {
  var lead = document.getElementById('chapters-lead');
  var grid = document.getElementById('chapters-grid');
  var exam    = state.nav.exam;
  var subject = state.nav.subject;

  lead.textContent = 'Loading chapters...';
  grid.innerHTML   = '';

  var chapters;
  try {
    chapters = await QuestionApi.getChaptersForSubject(exam.id, subject.id);
    state.cache.chapters = chapters;
  } catch (err) {
    lead.textContent = 'Could not load chapters: ' + err.message;
    return;
  }

  // Load topic index to compute question counts
  var topicIndex = state.cache.topicIndex;
  if (!topicIndex) {
    try {
      topicIndex = await QuestionApi._loadTopicIndex();
      state.cache.topicIndex = topicIndex;
    } catch(e) { topicIndex = {}; }
  }

  function chapterQuestionCount(chapterId) {
    var prefix = exam.id + '|' + subject.id + '|' + chapterId + '|';
    var n = 0;
    Object.entries(topicIndex).forEach(function(entry) {
      if (entry[0].indexOf(prefix) === 0) n += entry[1].length;
    });
    return n;
  }

  var chList = Object.values(chapters).map(function(ch) {
    return Object.assign({}, ch, { questionCount: chapterQuestionCount(ch.id) });
  }).sort(function(a, b) { return b.questionCount - a.questionCount; });

  var total = chList.reduce(function(s, c) { return s + c.questionCount; }, 0);
  lead.textContent = escapeHtml(displayName(exam)) + ' \u00B7 ' + escapeHtml(displayName(subject))
    + ' -- ' + chList.length + ' chapters \u00B7 ' + total.toLocaleString() + ' questions';

  grid.innerHTML = chList.map(function(ch) {
    var topicCount = ch.topics ? ch.topics.length : 0;
    var name       = displayName(ch);
    return '<button class="card card--chapter" onclick="selectChapter(\'' + escapeHtml(ch.id) + '\')"'
      + ' aria-label="' + escapeHtml(name) + ': ' + ch.questionCount + ' questions">'
      + '<span class="card-name">' + escapeHtml(name) + '</span>'
      + '<span class="card-badges">'
      + '<span class="badge badge--q">' + ch.questionCount + ' Q</span>'
      + '<span class="badge badge--t">' + topicCount + ' topics</span>'
      + '</span>'
      + '</button>';
  }).join('');
}

async function selectChapter(chapterId) {
  var chapters = state.cache.chapters;
  var ch = chapters[chapterId];
  // Build a chapter object with reliable name
  state.nav.chapter = { id: chapterId, name: displayName(ch) };
  updateBreadcrumb();
  await loadChapterQuestions();
  showView('questions');
}

// --- Load chapter questions -------------------------------------------------

async function loadChapterQuestions() {
  var exam    = state.nav.exam;
  var subject = state.nav.subject;
  var chapter = state.nav.chapter;

  count.textContent = 'Loading questions...';
  list.innerHTML    = '<div class="empty loading-spinner">Fetching questions...</div>';
  state.questions   = [];
  state.selected.clear();
  refreshBar();

  try {
    var qs = await QuestionApi.getQuestionsByChapter(exam.id, subject.id, chapter.id);
    state.questions = qs;
    count.textContent = qs.length + ' questions in "' + escapeHtml(chapter.name) + '"';
    render();
  } catch (err) {
    count.textContent = 'Load failed';
    list.innerHTML = '<div class="empty"><strong>Could not load questions.</strong><br>' + escapeHtml(err.message) + '</div>';
    console.error('[loadChapterQuestions]', err);
  }
}

// --- Render questions (grouped by paper, year desc) -------------------------

function visibleQuestions() {
  var query = state.query.trim().toLowerCase();
  if (!query) return state.questions;
  return state.questions.filter(function(item) {
    return JSON.stringify(item).toLowerCase().indexOf(query) !== -1;
  });
}

function selectedQuestions() {
  return state.questions.filter(function(item) { return state.selected.has(item.id); });
}

function renderQuestionCard(item, index) {
  var id   = item.id;
  var type = resolveQuestionType(item.questionType);

  // ── Options — rendered as clickable practice buttons ──────────────────
  var optEntries  = Object.entries(item.options || {});
  var correctKey  = String(item.correct_answer || '').trim();

  // Encode answer + explanation into data attrs so no global map is needed
  var expl = '';
  if (Array.isArray(item.explanations)) {
    var m2 = item.explanations.find(function(e) {
      return e && e.type === 'text' && e.title && e.title.toLowerCase().indexOf('method2') !== -1 && e.content;
    });
    if (!m2) m2 = item.explanations.find(function(e) { return e && e.type === 'text' && e.content; });
    if (m2) expl = m2.content;
  }
  var explAttr = escapeHtml(expl);
  var corrAttr = escapeHtml(correctKey);

  var optionsHtml = '';
  if (optEntries.length) {
    optionsHtml = '<ul class="options">' +
      optEntries.map(function(entry) {
        return '<li class="opt-btn" data-key="' + escapeHtml(entry[0]) + '" data-qid="' + escapeHtml(id) + '">'
          + '<span class="option-key">' + escapeHtml(entry[0]) + '.</span>'
          + '<span class="option-content">' + renderHtmlContent(entry[1]) + '</span>'
          + '</li>';
      }).join('')
    + '</ul>';
  }

  // Submit button (hidden until an option is chosen)
  var submitBtn = '<button class="submit-btn" data-qid="' + escapeHtml(id) + '"'
    + ' data-correct="' + corrAttr + '" data-expl="' + explAttr + '"'
    + ' style="display:none" type="button">Submit Answer</button>';

  // Revealed answer panel (hidden initially)
  var revealPanel = '<div class="reveal-panel" id="reveal-' + escapeHtml(id) + '" style="display:none"></div>';

  // For integer/numerical types show answer badge immediately
  var ANSWER_TYPES = ['integer', 'numerical', 'subjective', 'fill-blanks'];
  var showAnswer   = ANSWER_TYPES.indexOf(type) !== -1 && correctKey !== '';
  var answerBadge  = showAnswer
    ? '<div class="answer-badge"><span class="answer-label">Ans:</span><span class="answer-value">'
        + (['integer','numerical'].indexOf(type) !== -1 ? escapeHtml(correctKey) : renderHtmlContent(correctKey))
        + '</span></div>'
    : '';

  var checked = state.selected.has(id) ? ' checked' : '';
  var sel     = state.selected.has(id) ? ' selected' : '';

  return '<article class="question' + sel + '" data-id="' + escapeHtml(id) + '">'
    + '<label class="check-wrap" aria-label="Select question ' + (index+1) + '">'
    + '<input class="check" type="checkbox" data-id="' + escapeHtml(id) + '"' + checked + '>'
    + '<span class="check-label">Select</span>'
    + '</label>'
    + '<div>'
    + '<div class="meta">'
    + '<span class="paper">' + escapeHtml(item.paperTitle || 'Untitled paper') + '</span>'
    + '<span class="year">'  + escapeHtml(String(item.year || '')) + '</span>'
    + '<span class="type-badge">' + escapeHtml(item.questionType || '') + '</span>'
    + '<span class="id">' + escapeHtml(id) + '</span>'
    + '</div>'
    + '<div class="content">' + renderHtmlContent(item.question_text || '') + '</div>'
    + optionsHtml
    + submitBtn
    + revealPanel
    + answerBadge
    + '</div>'
    + '</article>';
}

function render() {
  var visible = visibleQuestions();
  var total   = state.questions.length;
  if (total > 0) {
    count.textContent = state.selected.size + ' selected / ' + total + ' questions';
  }

  if (!total) { list.innerHTML = ''; refreshBar(); return; }

  if (!visible.length) {
    list.innerHTML = '<div class="empty">No questions match your search.</div>';
    refreshBar();
    return;
  }

  // Group by paper, sorted year desc then title asc
  var byPaper    = {};
  var paperOrder = [];
  visible.forEach(function(q) {
    var key = q.paperId || 'unknown';
    if (!byPaper[key]) {
      byPaper[key] = { title: q.paperTitle || q.paperId, year: q.year || 0, questions: [] };
      paperOrder.push(key);
    }
    byPaper[key].questions.push(q);
  });

  paperOrder.sort(function(a, b) {
    var ya = byPaper[a].year, yb = byPaper[b].year;
    if (yb !== ya) return yb - ya;
    return byPaper[a].title.localeCompare(byPaper[b].title);
  });

  var html = '';
  var globalIndex = 0;
  paperOrder.forEach(function(paperId) {
    var group = byPaper[paperId];
    var qs    = group.questions;
    html += '<details class="chapter-group" open>'
      + '<summary class="chapter-header">'
      + '<span class="chapter-name">' + escapeHtml(group.title) + '</span>'
      + '<span class="chapter-count">' + qs.length + ' question' + (qs.length !== 1 ? 's' : '') + '</span>'
      + '</summary>'
      + '<div class="chapter-questions">'
      + qs.map(function(item, i) { return renderQuestionCard(item, globalIndex + i); }).join('')
      + '</div>'
      + '</details>';
    globalIndex += qs.length;
  });

  list.innerHTML = html;
  refreshBar();
}

// --- Selection --------------------------------------------------------------

function toggle(id, checked) {
  checked ? state.selected.add(id) : state.selected.delete(id);
  // Update visual state without full re-render (keeps practice-mode state)
  var art = list.querySelector('article[data-id="' + id + '"]');
  if (art) art.classList.toggle('selected', checked);
  var cb  = list.querySelector('input.check[data-id="' + id + '"]');
  if (cb)  cb.checked = checked;
  // Update count
  var total = state.questions.length;
  if (total > 0) count.textContent = state.selected.size + ' selected / ' + total + ' questions';
  refreshBar();
}

list.addEventListener('change', function(e) {
  if (e.target.matches('.check')) toggle(e.target.dataset.id, e.target.checked);
});

// --- Practice mode (option click → Submit → Reveal) -----------------------

list.addEventListener('click', function(e) {
  // Option button clicked
  var optBtn = e.target.closest('.opt-btn');
  if (optBtn) {
    var qid = optBtn.dataset.qid;
    var art = list.querySelector('article[data-id="' + qid + '"]');
    if (!art) return;
    // Mark chosen option
    art.querySelectorAll('.opt-btn').forEach(function(li) { li.classList.remove('opt-chosen'); });
    optBtn.classList.add('opt-chosen');
    // Store chosen key on article
    art.dataset.chosen = optBtn.dataset.key;
    // Show submit button
    var sb = art.querySelector('.submit-btn');
    if (sb) sb.style.display = '';
    return;
  }

  // Submit button clicked
  var submitBtn = e.target.closest('.submit-btn');
  if (submitBtn) {
    var qid     = submitBtn.dataset.qid;
    var art     = list.querySelector('article[data-id="' + qid + '"]');
    if (!art) return;
    var correct = submitBtn.dataset.correct;
    var expl    = submitBtn.dataset.expl;
    var chosen  = art.dataset.chosen || '';
    var isRight = chosen.trim().toUpperCase() === correct.trim().toUpperCase();

    // Colour the options
    art.querySelectorAll('.opt-btn').forEach(function(li) {
      var key = li.dataset.key || '';
      li.classList.remove('opt-correct', 'opt-wrong', 'opt-chosen');
      if (key.trim().toUpperCase() === correct.trim().toUpperCase()) {
        li.classList.add('opt-correct');
      } else if (key.trim().toUpperCase() === chosen.trim().toUpperCase()) {
        li.classList.add('opt-wrong');
      }
    });

    // Reveal panel
    var panel = art.querySelector('.reveal-panel');
    if (panel) {
      var resultHtml = isRight
        ? '<div class="reveal-result reveal-correct">✅ Correct!</div>'
        : '<div class="reveal-result reveal-wrong">❌ Incorrect. Correct answer: <strong>' + escapeHtml(correct) + '</strong></div>';
      var explHtml = expl
        ? '<div class="reveal-expl">' + renderHtmlContent(expl) + '</div>'
        : '<div class="reveal-expl reveal-no-expl">No explanation available.</div>';
      panel.innerHTML = resultHtml + explHtml;
      panel.style.display = '';
      // Scroll into view
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Hide submit button after submission
    submitBtn.style.display = 'none';
    return;
  }
});

document.querySelector('#search').addEventListener('input', function(e) {
  state.query = e.target.value;
  render();
});

document.querySelector('#selectVisible').addEventListener('click', function() {
  visibleQuestions().forEach(function(item) { state.selected.add(item.id); });
  render();
});

document.querySelector('#clearSelected').addEventListener('click', function() {
  state.selected.clear();
  render();
});

// --- Generation bar ---------------------------------------------------------

function refreshBar() {
  if (state.questions.length === 0) { PptBar.hide(); return; }
  PptBar.show({
    selectedCount: state.selected.size,
    busy:          state.pptBusy,
    progressText:  state.pptProgress || '',
    onDark:  function() { startPpt('dark');  },
    onLight: function() { startPpt('light'); },
    onQPdf:  function() { startPdf('questions');  },
    onAKPdf: function() { startPdf('answerkey'); },
  });
}

async function startPdf(mode) {
  if (state.pptBusy) return;
  var sel = selectedQuestions();
  if (!sel.length) { alert('Select at least one question first.'); return; }
  var settings = await PdfModal.open(mode, sel[0] && sel[0].subject || '');
  if (!settings) return;
  generatePdf(sel, settings, mode);
}

async function startPpt(themeKey) {
  if (state.pptBusy) return;
  var sel = selectedQuestions();
  if (!sel.length) { alert('Select at least one question first.'); return; }
  var settings = await PptModal.open(themeKey, sel[0] && sel[0].subject || '');
  if (!settings) return;

  state.pptBusy     = true;
  state.pptProgress = 'Starting...';
  refreshBar();
  try {
    await generatePpt(sel, themeKey, function(current, total, status) {
      state.pptProgress = status || ('Slide ' + current + '/' + total);
      refreshBar();
    });
  } catch (err) {
    console.error('[PPT]', err);
    alert('PPT generation failed: ' + err.message);
  } finally {
    state.pptBusy     = false;
    state.pptProgress = '';
    refreshBar();
  }
}

// --- Bootstrap --------------------------------------------------------------

function initApp() {
  updateBreadcrumb();
  renderExamsView();
}

if (window.katex) {
  initApp();
} else {
  window.addEventListener('load', initApp);
}
