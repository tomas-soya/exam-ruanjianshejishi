'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readRecord } = require('./record-codec');
const { resolveMappedIdentifier } = require('./identifier-map');
const {
  sanitizeQuestion,
  assertStrictAnswerIsolation
} = require('../../../exam-contracts/dist/index.js');

/**
 * Authoritative Canonical Paper Mappings (Paper Alias -> Canonical Paper).
 * Unifies duplicate entries across reconciliation variants:
 * 1. 2025-11 Objective reconciliation edition -> canonical paper
 * 2. 2025-05 Objective reconciliation edition -> canonical paper
 * 3. Reconciliation case papers -> canonical case papers
 */
const PAPER_CANONICAL_MAP = new Map([
  ['sd-2025-11-objective-ca64ac1a7b', 'sd-2025-11-objective-538ce18411'],
  ['sd-2025-05-objective-d3096bb60a', 'sd-2025-05-objective-06b5ee83d9'],
  ['sd-2020-unknown-case-d1faf9ce88', 'sd-2020-11-case-6cc1a51bb5'],
  ['sd-2019-05-case-f40b76fa80', 'sd-2019-05-case-137bfb3b31'],
  ['sd-2018-11-case-e1415fdf90', 'sd-2018-11-case-f64ef3dc89'],
  ['sd-2017-05-case-e6283cf503', 'sd-2017-05-case-a174e495a6'],
  ['sd-2016-05-case-caa3234a9b', 'sd-2016-05-case-8e9c988678']
]);

const PAPER_ALIAS_MAP = new Map();
for (const [aliasId, canonicalId] of PAPER_CANONICAL_MAP.entries()) {
  if (!PAPER_ALIAS_MAP.has(canonicalId)) {
    PAPER_ALIAS_MAP.set(canonicalId, [canonicalId]);
  }
  PAPER_ALIAS_MAP.get(canonicalId).push(aliasId);
}

function getCanonicalPaperId(paperId) {
  if (!paperId) return paperId;
  return PAPER_CANONICAL_MAP.get(paperId) || paperId;
}

function getPaperAliasIds(canonicalOrAliasPaperId) {
  if (!canonicalOrAliasPaperId) return [];
  const canonicalId = getCanonicalPaperId(canonicalOrAliasPaperId);
  const aliases = PAPER_ALIAS_MAP.get(canonicalId);
  return aliases ? [...aliases] : [canonicalId];
}

function isCanonicalPaper(paperId) {
  if (!paperId) return false;
  return !PAPER_CANONICAL_MAP.has(paperId);
}

/**
 * 10 Verified Pilot Papers (W1A 3 papers + W1B batch 1 7 papers)
 * As authorized by human on 2026-10-03.
 */
const VERIFIED_PAPER_IDS = [
  'sd-2023-05-case-918de312c1',
  'sd-2023-05-objective-928ba3c677',
  'sd-2023-11-objective-3b3e402852',
  'sd-2024-05-objective-10fc7916c3',
  'sd-2024-11-case-6d522ac639',
  'sd-2024-11-objective-4f81d3386c',
  'sd-2024-11-objective-096579e82d',
  'sd-2025-05-objective-06b5ee83d9',
  'sd-2025-11-objective-538ce18411',
  'sd-2026-05-objective-e1db86b5ef'
];

/**
 * Deterministically resolves real year and season/semester for a paper.
 * AC-01: Corrects erroneous year/semester (e.g. sd-2009-11-case-93702235a5 -> 2009年下半年).
 * Never treats paper sequence number as year.
 * Explicitly marks unknown if cannot confirm or if conflicting.
 * 00 / unknown semester is never treated as 下半年.
 */
function resolvePaperYearAndSeason(content) {
  if (!content) return { year: 'unknown', season: 'unknown' };

  let rawYear = content.year != null ? String(content.year).trim() : '';
  let rawSeason = content.season != null ? String(content.season).trim() : '';
  const title = String(content.title || '').trim();
  const id = String(content.id || '').trim();

  // 1. Parse from title
  let titleYear = null;
  const titleYearMatch = title.match(/(\d{4})年/);
  if (titleYearMatch) {
    titleYear = titleYearMatch[1];
  }

  let titleSeason = null;
  if (/上半年|5月/i.test(title)) {
    titleSeason = '05';
  } else if (/下半年|11月/i.test(title)) {
    titleSeason = '11';
  }

  // 2. Parse from paper ID
  let idYear = null;
  let idSeason = null;
  const compactIdMatch = id.match(/paper_\d+_(\d{4})(\d{2})/);
  if (compactIdMatch) {
    idYear = compactIdMatch[1];
    const mm = compactIdMatch[2];
    if (mm === '05') idSeason = '05';
    else if (mm === '11') idSeason = '11';
    else if (mm === '00') idSeason = '00';
  } else {
    const datedIdMatch = id.match(/(\d{4})-(\d{2})/);
    if (datedIdMatch) {
      idYear = datedIdMatch[1];
      idSeason = datedIdMatch[2];
    }
  }

  // 3. Resolve Year:
  // Must NOT treat paper sequence numbers (e.g. 65, 23, 26, < 1990) as year!
  let resolvedYear = 'unknown';
  const isRawYearValid4Digit = /^\d{4}$/.test(rawYear) && Number(rawYear) >= 1990 && Number(rawYear) <= 2099;

  if (titleYear && idYear) {
    if (titleYear === idYear) {
      resolvedYear = titleYear;
    } else {
      resolvedYear = 'unknown'; // conflict
    }
  } else if (titleYear) {
    if (isRawYearValid4Digit && rawYear !== titleYear) {
      resolvedYear = 'unknown'; // conflict
    } else {
      resolvedYear = titleYear;
    }
  } else if (idYear) {
    if (isRawYearValid4Digit && rawYear !== idYear) {
      resolvedYear = 'unknown'; // conflict
    } else {
      resolvedYear = idYear;
    }
  } else if (isRawYearValid4Digit) {
    resolvedYear = rawYear;
  } else {
    resolvedYear = 'unknown';
  }

  // 4. Resolve Season / Semester:
  let resolvedSeason = 'unknown';
  if (titleSeason && idSeason && idSeason !== '00') {
    if (titleSeason === idSeason) {
      resolvedSeason = titleSeason;
    } else {
      resolvedSeason = 'unknown'; // conflict
    }
  } else if (titleSeason) {
    resolvedSeason = titleSeason;
  } else if (idSeason && idSeason !== '00') {
    resolvedSeason = idSeason;
  } else if (rawSeason === '05' || rawSeason === '11') {
    resolvedSeason = rawSeason;
  } else if (idSeason === '00' || rawSeason === '00' || rawSeason === 'unknown') {
    resolvedSeason = 'unknown';
  }

  return {
    year: resolvedYear,
    season: resolvedSeason
  };
}

function getSeasonOrderScore(season) {
  if (season === '11' || season === '下半年') return 2;
  if (season === '05' || season === '上半年') return 1;
  return 0; // '00', 'unknown' comes last
}

function publicPaperTitle(title) {
  return String(title || '')
    .replace(/（专业解析\+参考答案）/g, '')
    .replace(/（免费版）：去重索引/g, '（补充试题）')
    .replace(/（补充试题）/g, '');
}

/**
 * AC-02: Sorts papers in numeric year descending order.
 * Within same year, 下半年 (11) before 上半年 (05), unknown at the end.
 * Stable tie-breaker by paper ID.
 */
function comparePapers(a, b) {
  const numA = Number(a.year);
  const numB = Number(b.year);
  const isNumA = Number.isFinite(numA) && a.year !== 'unknown';
  const isNumB = Number.isFinite(numB) && b.year !== 'unknown';

  if (isNumA && isNumB) {
    if (numB !== numA) {
      return numB - numA;
    }
  } else if (isNumA && !isNumB) {
    return -1;
  } else if (!isNumA && isNumB) {
    return 1;
  }

  const scoreA = getSeasonOrderScore(a.season);
  const scoreB = getSeasonOrderScore(b.season);
  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }

  return String(a.id || '').localeCompare(String(b.id || ''));
}

class QuestionBankLoader {
  constructor(baseDir, options = {}) {
    this.baseDir = baseDir || path.resolve(__dirname, '../../../../题库');
    this.papersDir = path.join(this.baseDir, 'papers');
    this.objQuestionsDir = path.join(this.baseDir, 'questions', 'objective');
    this.caseQuestionsDir = path.join(this.baseDir, 'questions', 'case');

    this.manifestReconPath = path.join(this.baseDir, 'manifest.reconciliation.json');
    this.canonicalMap = new Map(); // aliasId -> canonicalId
    this.aliasMap = new Map(); // canonicalId -> [aliasId]
    this.rawQuestionCache = new Map();
    this.reconciliationManifest = null;
    this._loadReconciliation();

    if (Array.isArray(options.paperIds)) {
      this.allowedPaperIds = options.paperIds;
      this._customPaperIds = true;
    } else if (options.includeAll || process.env.EXAM_LOAD_ALL_PAPERS === 'true') {
      this.allowedPaperIds = this.getAllPaperIds();
      this._customPaperIds = false;
    } else {
      this.allowedPaperIds = this.reconciliationManifest?.legacy_id_map ? this.getAllPaperIds() : VERIFIED_PAPER_IDS;
      this._customPaperIds = false;
    }
  }

  /**
   * Loads canonical/alias mapping and reconciliation audit from manifest.reconciliation.json.
   */
  _loadReconciliation() {
    if (!fs.existsSync(this.manifestReconPath)) return;
    try {
      const data = readRecord(this.manifestReconPath);
      this.reconciliationManifest = data;
      if (Array.isArray(data.cross_year_canonical_mappings)) {
        for (const item of data.cross_year_canonical_mappings) {
          const canonicalId = item.canonical_id;
          const aliases = [];
          if (Array.isArray(item.aliases)) {
            for (const a of item.aliases) {
              const aliasId = a.question_id;
              this.canonicalMap.set(aliasId, canonicalId);
              aliases.push(aliasId);
            }
          }
          this.aliasMap.set(canonicalId, aliases);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * Resolves an alias ID to its canonical ID (returns original ID if already canonical).
   */
  getCanonicalQuestionId(questionId) {
    questionId = this.resolveLegacyId(questionId);
    return this.canonicalMap.get(questionId) || questionId;
  }

  resolveLegacyId(id) {
    return resolveMappedIdentifier(this.reconciliationManifest?.legacy_id_map, id);
  }

  /**
   * Gets all known aliases for a given canonical ID.
   */
  getAliasQuestionIds(canonicalId) {
    return this.aliasMap.get(canonicalId) || [];
  }

  /**
   * Returns authoritative reconciliation audit statistics.
   */
  getReconciliationAudit() {
    if (this.reconciliationManifest && this.reconciliationManifest.audit_summary) {
      return this.reconciliationManifest.audit_summary;
    }
    return {
      sources_and_physical_records: {
        catalog_raw_pre_dedup_objective_records: 1516,
        catalog_raw_pre_dedup_case_groups: 96,
        bank_physical_objective_questions: 1485,
        bank_reused_index_objective_records: 31,
        bank_physical_case_groups: 96
      },
      deduplication_and_canonical: {
        cross_year_duplicate_objective_groups: 15,
        redundant_objective_instances: 16,
        unique_objective_knowledge_entities: 1469,
        unique_case_knowledge_entities: 96,
        total_unique_knowledge_entities: 1565
      }
    };
  }

  /**
   * Resolves a paper alias ID to its canonical ID.
   */
  getCanonicalPaperId(paperId) {
    paperId = this.resolveLegacyId(paperId);
    return this.reconciliationManifest?.paper_canonical_mappings?.[paperId] || getCanonicalPaperId(paperId);
  }

  /**
   * Gets all known alias IDs for a paper including itself.
   */
  getPaperAliasIds(paperId) {
    const canonical = this.getCanonicalPaperId(paperId);
    const map = this.reconciliationManifest?.paper_canonical_mappings;
    return map ? [canonical, ...Object.keys(map).filter(id => map[id] === canonical)] : getPaperAliasIds(paperId);
  }

  /**
   * Checks if a paper ID is canonical.
   */
  isCanonicalPaper(paperId) {
    return this.getCanonicalPaperId(paperId) === paperId;
  }

  /**
   * Scans papers directory to list all available valid canonical paper IDs.
   * Excludes duplicate reconciliation/indexing variants.
   */
  getAllPaperIds() {
    if (!fs.existsSync(this.papersDir)) return VERIFIED_PAPER_IDS;
    try {
      return fs.readdirSync(this.papersDir)
        .filter(f => f.endsWith('.json') && !f.endsWith('.audit.json'))
        .map(f => f.replace(/\.json$/, ''))
        .filter(id => this.isCanonicalPaper(id))
        .sort();
    } catch (e) {
      return VERIFIED_PAPER_IDS;
    }
  }

  /**
   * Returns the 38 approved baseline papers (catalog baseline).
   */
  getApprovedBaselinePaperIds() {
    return this.reconciliationManifest?.baseline_paper_ids || this.getAllPaperIds();
  }

  /**
   * Lists allowed papers (defaults to verified pilot papers, or all canonical papers if configured).
   * AC-01: Corrects year and semester.
   * AC-02: Numerically sorted descending by year, 下半年 before 上半年, unknown at end.
   */
  listVerifiedPapers() {
    const papers = [];
    for (const paperId of this.allowedPaperIds) {
      const jsonPath = path.join(this.papersDir, `${paperId}.json`);
      if (fs.existsSync(jsonPath)) {
        try {
          const content = readRecord(jsonPath);
          let totalQuestions = 75;
          if (content.is_reused_index && Array.isArray(content.mappings)) {
            totalQuestions = content.mappings.length;
          } else if (typeof content.total_questions === 'number') {
            totalQuestions = content.total_questions;
          } else if (typeof content.total_groups === 'number') {
            totalQuestions = content.total_groups;
          } else if (Array.isArray(content.question_ids)) {
            totalQuestions = content.question_ids.length;
          } else if (Array.isArray(content.group_ids)) {
            totalQuestions = content.group_ids.length;
          }

          const resolved = resolvePaperYearAndSeason(content);

          papers.push({
            id: content.id,
            title: publicPaperTitle(content.title),
            year: resolved.year,
            season: resolved.season,
            rawYear: content.year,
            rawSeason: content.season,
            subject: content.subject,
            totalQuestions,
            standardQuestionGroups: content.standard_question_groups,
            sourceUrl: content.source_url
          });
        } catch (e) {
          // ignore corrupted file
        }
      }
    }
    papers.sort(comparePapers);
    return papers;
  }

  /**
   * Retrieves raw paper metadata with resolved real year and season (AC-01).
   * Supports seamless alias-to-canonical fallback if physical alias paper file is absent.
   */
  getPaper(paperId) {
    if (!paperId) return null;
    paperId = this.resolveLegacyId(paperId);
    const canonicalId = this.getCanonicalPaperId(paperId);
    if (this._customPaperIds && !this.allowedPaperIds.includes(paperId) && !this.allowedPaperIds.includes(canonicalId)) {
      return null;
    }
    let jsonPath = path.join(this.papersDir, `${paperId}.json`);
    if (!fs.existsSync(jsonPath)) {
      jsonPath = path.join(this.papersDir, `${canonicalId}.json`);
    }
    if (!fs.existsSync(jsonPath)) {
      return null;
    }
    try {
      const raw = readRecord(jsonPath);
      const resolved = resolvePaperYearAndSeason(raw);
      return {
        ...raw,
        title: publicPaperTitle(raw.title),
        year: resolved.year,
        season: resolved.season,
        rawYear: raw.year,
        rawSeason: raw.season
      };
    } catch {
      return null;
    }
  }

  /**
   * Retrieves raw question data (SERVER INTERNAL ONLY, contains answers).
   * First checks direct physical ID to preserve paper/session history.
   * If not found on disk, falls back to canonical question if mapped.
   */
  getRawQuestion(questionId) {
    questionId = this.resolveLegacyId(questionId);
    if (this.rawQuestionCache && this.rawQuestionCache.has(questionId)) {
      return this.rawQuestionCache.get(questionId);
    }

    let result = null;
    // 1. Check direct physical objective file
    const objPath = path.join(this.objQuestionsDir, `${questionId}.json`);
    if (fs.existsSync(objPath)) {
      result = readRecord(objPath);
    } else {
      // 2. Check direct physical case file
      const casePath = path.join(this.caseQuestionsDir, `${questionId}.json`);
      if (fs.existsSync(casePath)) {
        result = readRecord(casePath);
      } else {
        // 3. Fallback to canonical entity if questionId is an alias
        const canonicalId = this.canonicalMap.get(questionId);
        if (canonicalId && canonicalId !== questionId) {
          const canonicalObjPath = path.join(this.objQuestionsDir, `${canonicalId}.json`);
          if (fs.existsSync(canonicalObjPath)) {
            const canonicalData = readRecord(canonicalObjPath);
            // Return canonical data with original requested ID preserved for session history
            result = {
              ...canonicalData,
              id: questionId,
              canonical_id: canonicalId,
              is_alias: true
            };
          }
        }
      }
    }

    if (result && this.rawQuestionCache) {
      this.rawQuestionCache.set(questionId, result);
    }
    return result;
  }

  /**
   * Retrieves sanitized question safe for client consumption before submission.
   */
  getSanitizedQuestion(questionId) {
    const raw = this.getRawQuestion(questionId);
    if (!raw) return null;
    const sanitized = sanitizeQuestion(raw);
    assertStrictAnswerIsolation(sanitized);

    if (this.canonicalMap.has(questionId)) {
      sanitized.canonicalId = this.canonicalMap.get(questionId);
      sanitized.isAlias = true;
    }

    return sanitized;
  }

  /**
   * Gets list of question IDs for a paper.
   */
  getPaperQuestionIds(paperId) {
    const paper = this.getPaper(paperId);
    if (!paper) return [];

    if (paper.subject === 'case') {
      return paper.group_ids || (paper.groups ? paper.groups.map(g => g.id) : []);
    }

    if (paper.is_reused_index && Array.isArray(paper.mappings)) {
      return paper.mappings.map(m => m.target_question_id || m.targetQuestionId);
    }

    if (Array.isArray(paper.question_ids) && paper.question_ids.length > 0) {
      return paper.question_ids;
    }

    const ids = [];
    for (let i = 1; i <= 75; i++) {
      const padded = String(i).padStart(3, '0');
      const qid = `${paperId}-q${padded}`;
      const objPath = path.join(this.objQuestionsDir, `${qid}.json`);
      if (fs.existsSync(objPath)) {
        ids.push(qid);
      }
    }
    return ids;
  }

  /**
   * Gets all questions for a paper in sanitized form.
   */
  getSanitizedPaperQuestions(paperId) {
    const qids = this.getPaperQuestionIds(paperId);
    const questions = [];
    for (const qid of qids) {
      const sanitized = this.getSanitizedQuestion(qid);
      if (sanitized) {
        questions.push(sanitized);
      }
    }
    return questions;
  }

  /**
   * Gets raw questions for a paper (SERVER INTERNAL ONLY, for scoring and report generation).
   */
  getRawPaperQuestions(paperId) {
    const qids = this.getPaperQuestionIds(paperId);
    const questions = [];
    for (const qid of qids) {
      const raw = this.getRawQuestion(qid);
      if (raw) {
        questions.push(raw);
      }
    }
    return questions;
  }

  /**
   * Retrieves sanitized questions matching a chapter from verified papers.
   */
  getQuestionsByChapter(chapter, { limit = 50, subject } = {}) {
    const questions = [];
    const papers = this.listVerifiedPapers();

    for (const p of papers) {
      if (subject && p.subject !== subject) continue;
      const qids = this.getPaperQuestionIds(p.id);
      for (const qid of qids) {
        const raw = this.getRawQuestion(qid);
        if (raw && (raw.chapter === chapter || (raw.chapter && raw.chapter.startsWith(chapter)))) {
          const sanitized = this.getSanitizedQuestion(qid);
          if (sanitized) {
            questions.push(sanitized);
            if (questions.length >= limit) return questions;
          }
        }
      }
    }
    return questions;
  }

  /**
   * Aggregates available chapters and question counts across verified papers.
   */
  listChapters() {
    const chaptersMap = new Map();

    const papers = this.listVerifiedPapers();
    for (const p of papers) {
      for (const qid of this.getPaperQuestionIds(p.id)) {
        const raw = this.getRawQuestion(qid);
        if (!raw) continue;
        const ch = raw.chapter || '未分类';
        const stats = chaptersMap.get(ch) || { chapter: ch, objectiveCount: 0, caseCount: 0 };
        if (p.subject === 'case') stats.caseCount += 1;
        else stats.objectiveCount += 1;
        chaptersMap.set(ch, stats);
      }
    }

    return Array.from(chaptersMap.values()).sort((a, b) => (b.objectiveCount + b.caseCount) - (a.objectiveCount + a.caseCount));
  }
}

module.exports = {
  VERIFIED_PAPER_IDS,
  QuestionBankLoader,
  resolvePaperYearAndSeason,
  comparePapers,
  getSeasonOrderScore,
  PAPER_CANONICAL_MAP,
  PAPER_ALIAS_MAP,
  getCanonicalPaperId,
  getPaperAliasIds,
  isCanonicalPaper
};
