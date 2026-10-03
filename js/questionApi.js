// questionApi.js — Browser-compatible Question Bank API
// Fetches data from GitHub via jsDelivr CDN.
// All functions return Promises. Resolved data is cached in memory.

const QuestionApi = (() => {
  // CDN_BASE is defined in js/config.js (APP_CONFIG.CDN_BASE) — do not duplicate here.
  const CDN_BASE = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.CDN_BASE : 'https://cdn.jsdelivr.net/gh/AnujKumarKushwaha795/question-bank-push@main') + '/';

  // ── Cache ──────────────────────────────────────────────────────────────────
  const _raw   = {};   // path -> parsed JSON (index/hierarchy files)
  const _files = {};   // filePath -> questions[] (paper question arrays)

  async function _fetch(path) {
    if (_raw[path]) return _raw[path];
    const r = await fetch(CDN_BASE + path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${CDN_BASE + path}`);
    _raw[path] = await r.json();
    return _raw[path];
  }

  // ── Index loaders ──────────────────────────────────────────────────────────
  const _idx = {
    papers:       () => _fetch('data/indexes/papers.json'),
    byId:         () => _fetch('data/indexes/questions-by-id.json'),
    byPaper:      () => _fetch('data/indexes/questions-by-paper.json'),
    bySubject:    () => _fetch('data/indexes/questions-by-subject.json'),
    byTopic:      () => _fetch('data/indexes/questions-by-topic.json'),
  };

  // ── Hierarchy loaders ──────────────────────────────────────────────────────
  const _hier = {
    exams:    () => _fetch('data/hierarchy/exams.json'),
    subjects: () => _fetch('data/hierarchy/subjects.json'),
    chapters: () => _fetch('data/hierarchy/chapters.json'),
    topics:   () => _fetch('data/hierarchy/topics.json'),
  };

  // ── Load a paper's question array (cached) ─────────────────────────────────
  async function _loadPaperFile(filePath) {
    if (_files[filePath]) return _files[filePath];
    const data = await _fetch(filePath);
    _files[filePath] = Array.isArray(data) ? data : [];
    return _files[filePath];
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Public API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Get a single question by its unique ID.
   * Uses questions-by-id.json index → loads only the containing paper file.
   */
  async function getQuestionById(id) {
    const index = await _idx.byId();
    const entry = index[id];
    if (!entry) return null;
    const questions = await _loadPaperFile(entry.file);
    return questions[entry.index] || null;
  }

  /**
   * Get all questions in a paper.
   * @param {string} paperId
   */
  async function getQuestionsByPaper(paperId) {
    const papers = await _idx.papers();
    const paper  = papers[paperId];
    if (!paper) return [];
    return _loadPaperFile(paper.file);
  }

  /**
   * Get all questions for an exam+subject (across all papers).
   * Strategy: uses papers index to find matching papers, loads each file,
   * then filters — avoids loading the giant by-id index.
   * @param {string} exam  e.g. 'jee-main'
   * @param {string} subject  e.g. 'physics'
   */
  async function getQuestionsBySubject(exam, subject) {
    const papers = await _idx.papers();
    const matching = Object.values(papers).filter(p => p.exam === exam);
    const arrays   = await Promise.all(matching.map(p => _loadPaperFile(p.file)));
    return arrays.flat().filter(q => q.subject === subject);
  }

  /**
   * Get all questions for an exam+subject+chapter (across all papers).
   * Strategy:
   *   1. questions-by-topic.json  → collect IDs for this chapter
   *   2. questions-by-paper.json  → find which paper files contain those IDs
   *   3. Load only those paper files, filter by subject+chapter client-side
   * This avoids loading the large questions-by-id.json index.
   */
  async function getQuestionsByChapter(exam, subject, chapter) {
    const topicIdx = await _idx.byTopic();
    const prefix   = `${exam}|${subject}|${chapter}|`;
    const chapterIds = new Set();
    for (const [key, ids] of Object.entries(topicIdx)) {
      if (key.startsWith(prefix)) ids.forEach(id => chapterIds.add(id));
    }
    if (chapterIds.size === 0) return [];

    // Find paper files that contain at least one of these IDs
    const paperIdx    = await _idx.byPaper();
    const filesToLoad = new Set();
    for (const [, entry] of Object.entries(paperIdx)) {
      if (entry.questionIds.some(id => chapterIds.has(id))) {
        filesToLoad.add(entry.file);
      }
    }

    // Load those files and filter
    const arrays = await Promise.all([...filesToLoad].map(f => _loadPaperFile(f)));
    return arrays.flat().filter(q => q.subject === subject && q.chapter === chapter);
  }

  /**
   * Get all questions for a specific exam|subject|chapter|topic.
   * Uses questions-by-topic index directly.
   */
  async function getQuestionsByTopic(exam, subject, chapter, topic) {
    const topicIdx = await _idx.byTopic();
    const key      = `${exam}|${subject}|${chapter}|${topic}`;
    const ids      = topicIdx[key] || [];
    return Promise.all(ids.map(id => getQuestionById(id)));
  }

  /**
   * Flexible filter function. Resolves the most efficient fetch strategy.
   * @param {object} filters  { exam, subject, chapter, topic, paperId, questionType, difficulty, year }
   */
  async function getQuestionsByFilters(filters = {}) {
    const { exam, subject, chapter, topic, paperId, questionType, difficulty, year } = filters;

    let qs;

    if (paperId) {
      // Fastest: direct paper fetch
      qs = await getQuestionsByPaper(paperId);
      if (subject)      qs = qs.filter(q => q.subject === subject);
      if (chapter)      qs = qs.filter(q => q.chapter === chapter);
      if (topic)        qs = qs.filter(q => q.topic   === topic);
    } else if (exam && subject && chapter && topic) {
      qs = await getQuestionsByTopic(exam, subject, chapter, topic);
    } else if (exam && subject && chapter) {
      qs = await getQuestionsByChapter(exam, subject, chapter);
    } else if (exam && subject) {
      qs = await getQuestionsBySubject(exam, subject);
    } else {
      return [];  // must specify at least exam+subject
    }

    if (questionType) qs = qs.filter(q => q.questionType === questionType);
    if (difficulty)   qs = qs.filter(q => q.difficulty   === difficulty);
    if (year)         qs = qs.filter(q => q.year         === year);

    return qs.filter(Boolean);  // remove any nulls from failed resolves
  }

  /**
   * Get `count` random questions matching filters.
   */
  async function getRandomQuestions(filters = {}, count = 10) {
    const qs       = await getQuestionsByFilters(filters);
    const shuffled = qs.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Validate a question object against the required schema rules.
   * Returns { valid: boolean, errors: string[] }
   */
  function validateQuestion(question) {
    const errors = [];
    const required = ['id','exam','subject','chapter','topic','paperId','paperTitle','questionType','question_text','correct_answer','year'];
    required.forEach(f => { if (!question[f] && question[f] !== 0) errors.push(`Missing required field: ${f}`); });

    const validTypes = ['single-select','multiple-select','integer','match','subjective','true-false'];
    if (question.questionType && !validTypes.includes(question.questionType)) {
      errors.push(`Invalid questionType: "${question.questionType}". Must be one of: ${validTypes.join(', ')}`);
    }
    const validDiff = ['easy','medium','hard'];
    if (question.difficulty && !validDiff.includes(question.difficulty)) {
      errors.push(`Invalid difficulty: "${question.difficulty}". Must be one of: ${validDiff.join(', ')}`);
    }
    if (typeof question.year !== 'number' || !Number.isInteger(question.year)) {
      errors.push('year must be an integer');
    }
    if (!Array.isArray(question.explanations)) {
      errors.push('explanations must be an array');
    }
    return { valid: errors.length === 0, errors };
  }

  // ── Hierarchy helpers (used by nav panel) ──────────────────────────────────

  /** Returns the full papers index: { [paperId]: { paperId, exam, year, title, file, questionCount } } */
  async function getPapers() { return _idx.papers(); }

  /**
   * Exposes the raw topic index — used by app.js to compute per-chapter question counts
   * without triggering an additional full fetch.
   */
  async function _loadTopicIndex() { return _idx.byTopic(); }

  /** Returns the full hierarchy: { exams, subjects, chapters, topics } */
  async function getHierarchy() {
    const [exams, subjects, chapters, topics] = await Promise.all([
      _hier.exams(), _hier.subjects(), _hier.chapters(), _hier.topics(),
    ]);
    return { exams, subjects, chapters, topics };
  }

  /** Returns exams.json */
  async function getExams() { return _hier.exams(); }

  /** Returns subjects.json scoped to one exam */
  async function getSubjectsForExam(exam) {
    const subjects = await _hier.subjects();
    return subjects[exam] || {};
  }

  /** Returns chapters.json scoped to exam+subject */
  async function getChaptersForSubject(exam, subject) {
    const chapters = await _hier.chapters();
    return (chapters[exam] && chapters[exam][subject]) || {};
  }

  /** Returns topics for a specific chapter */
  async function getTopicsForChapter(exam, subject, chapter) {
    const chapters = await _hier.chapters();
    const ch = chapters[exam]?.[subject]?.[chapter];
    return ch ? ch.topics : [];
  }

  /** Clears all caches (useful after data update) */
  function clearCache() {
    Object.keys(_raw).forEach(k => delete _raw[k]);
    Object.keys(_files).forEach(k => delete _files[k]);
  }

  return {
    // Primary query functions
    getQuestionById,
    getQuestionsByPaper,
    getQuestionsBySubject,
    getQuestionsByChapter,
    getQuestionsByTopic,
    getQuestionsByFilters,
    getRandomQuestions,
    // Validation
    validateQuestion,
    // Hierarchy / nav
    getPapers,
    getHierarchy,
    getExams,
    getSubjectsForExam,
    getChaptersForSubject,
    getTopicsForChapter,
    // Internal helpers exposed for app.js
    _loadTopicIndex,
    // Utilities
    clearCache,
  };
})();
