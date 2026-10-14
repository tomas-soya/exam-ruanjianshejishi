/**
 * @ruankao/exam-contracts - Answer Isolation Safeguards
 * 
 * Invariant:
 * Pre-submission question payload must NEVER contain answers, analysis,
 * solution code blocks, or solution images.
 */

import {
  SanitizedObjectiveQuestion,
  SanitizedCaseQuestion,
  SanitizedQuestion,
  QuestionAsset,
  QuestionCodeBlock,
  QuestionOption
} from './types';

const FORBIDDEN_LEAK_KEYS = [
  'answers',
  'effective_answer',
  'platform_answer',
  'curated_answer',
  'analysis',
  'solution_and_analysis',
  'solution',
  'solutionCodeBlocks',
  'solutionImages'
];

/**
 * Validates that an object contains NO leaked answer or solution fields.
 */
export function assertStrictAnswerIsolation(obj: any, path = 'root'): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertStrictAnswerIsolation(obj[i], `${path}[${i}]`);
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    const currentPath = `${path}.${key}`;
    if (FORBIDDEN_LEAK_KEYS.includes(key)) {
      throw new Error(`[Security Violation] Answer leak detected at path: ${currentPath}`);
    }

    // Check assets or code blocks for solution type
    if ((key === 'images' || key === 'codeBlocks' || key === 'code_blocks') && Array.isArray(obj[key])) {
      for (const item of obj[key]) {
        if (item && item.type === 'solution') {
          throw new Error(`[Security Violation] Solution asset leak detected at: ${currentPath} (type: 'solution')`);
        }
      }
    }

    assertStrictAnswerIsolation(obj[key], currentPath);
  }
}

function isExamStemImage(img: any): boolean {
  if (!img) return false;
  if (img.type && img.type !== 'stem') return false;
  if (img.owner && img.owner !== 'stem' && !/^option:[A-D]$/.test(img.owner) && !/^subquestion:/.test(img.owner)) return false;
  const url = String(img.source_url || img.sourceUrl || '').toLowerCase();
  const localPath = String(img.local_path || img.localPath || '').toLowerCase();
  if (url.includes('avatars.githubusercontent.com') || url.includes('/avatar') || localPath.includes('/avatar')) {
    return false;
  }
  return true;
}

function normalizeStemAsset(img: any): QuestionAsset | null {
  if (!isExamStemImage(img)) return null;
  return {
    type: 'stem' as const,
    localPath: img.local_path || img.localPath,
    sha256: img.sha256,
    sourceUrl: img.source_url || img.sourceUrl
  };
}

function normalizeStemCodeBlock(cb: any): QuestionCodeBlock | null {
  if (!cb) return null;
  if (typeof cb === 'string') {
    return {
      type: 'stem' as const,
      code: cb
    };
  }
  if (cb.type && cb.type !== 'stem') return null;
  return {
    type: 'stem' as const,
    code: cb.code || cb.content || '',
    language: cb.language
  };
}

/**
 * Sanitizes raw objective question data by removing answers and analysis.
 */
export function sanitizeObjectiveQuestion(raw: any): SanitizedObjectiveQuestion {
  const images: QuestionAsset[] = Array.isArray(raw.images)
    ? raw.images
        .filter(isExamStemImage)
        .map((img: any) => ({
          type: 'stem' as const,
          localPath: img.local_path || img.localPath,
          sha256: img.sha256,
          sourceUrl: img.source_url || img.sourceUrl
        }))
    : [];

  const codeBlocks: QuestionCodeBlock[] = Array.isArray(raw.code_blocks)
    ? raw.code_blocks
        .map(normalizeStemCodeBlock)
        .filter((cb): cb is QuestionCodeBlock => cb !== null)
    : [];

  const options: QuestionOption[] = Array.isArray(raw.options)
    ? raw.options.map((opt: any) => {
        const key = String(opt.key).trim().toUpperCase();
        const assets = Array.isArray(opt.images) ? opt.images : (typeof opt.image === 'string' ? [{ type: 'stem', local_path: opt.image }] : []);
        const images = assets.filter((asset: any) => isExamStemImage(asset) && (!asset.owner || asset.owner === 'stem' || asset.owner === 'option:' + key)).map((asset: any) => ({
          type: 'stem' as const,
          localPath: asset.local_path || asset.localPath,
          sha256: asset.sha256,
          sourceUrl: asset.source_url || asset.sourceUrl
        }));
        return { key, text: String(opt.text ?? ''), ...(images.length ? { images } : {}) };
      })
    : [];

  const sanitized: SanitizedObjectiveQuestion = {
    id: raw.id,
    standardId: raw.standard_id || raw.standardId || raw.id,
    paperId: raw.paper_id || raw.paperId,
    paperOrder: Number(raw.paper_order || raw.paperOrder || 0),
    subject: 'objective',
    chapter: raw.chapter || '未分类',
    sourceAnchor: raw.source_anchor || raw.sourceAnchor || '',
    questionStem: raw.question_stem || raw.questionStem || '',
    options,
    codeBlocks,
    images
  };

  // Self-verification
  assertStrictAnswerIsolation(sanitized);
  return sanitized;
}

/**
 * Sanitizes raw case question data by removing solution and analysis.
 */
function resolveCaseSubquestions(raw: any): any[] {
  const explicit = raw.subquestions || raw.subQuestions;
  if (Array.isArray(explicit) && explicit.length) return explicit;

  // Only standalone headings are boundaries: references inside a question,
  // numbered requirements and code blanks must not create extra answer fields.
  const stem = String(raw.shared_stem || raw.sharedStem || '');
  const headings: { start: number; end: number; title: string; number: number }[] = [];
  let offset = 0;
  let fence = '';
  const digits = (value: string) => value.replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10));
  for (const line of stem.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = '';
    } else if (!fence) {
      const match = line.match(/^[ \t]*(?:【问题[ \t]*([0-9０-９]+|[一二三四五六七八九十])[ \t]*】(?![ \t]*[中的])(?:[ \t]*[（(][ \t]*[0-9０-９.．]+[ \t]*分[ \t]*[）)])?|([0-9０-９]{1,2})[ \t]*[（(][ \t]*[0-9０-９.．]+[ \t]*分[ \t]*[）)])/);
      if (match) {
        const token = digits(match[1] || match[2]);
        const number = /^\d+$/.test(token) ? Number(token) : '一二三四五六七八九十'.indexOf(token) + 1;
        headings.push({ start: offset, end: offset + match[0].length, title: match[0].trim(), number });
      }
    }
    offset += line.length + 1;
  }
  // Reject ambiguous or repeated numbering rather than splitting by guesses.
  if (headings.length && headings.every((heading, index) => heading.number === index + 1)) {
    return headings.map((heading, index) => ({
      id: `sub${index + 1}`,
      title: heading.title,
      stem: stem.slice(heading.end, headings[index + 1]?.start ?? stem.length).trim()
    }));
  }
  const count = Number.isInteger(raw.subquestions_count) && raw.subquestions_count > 0 ? raw.subquestions_count : 1;
  return Array.from({ length: count }, (_, index) => ({ id: `sub${index + 1}`, title: `【问题 ${index + 1}】`, stem: '' }));
}

export function sanitizeCaseQuestion(raw: any): SanitizedCaseQuestion {
  const images: QuestionAsset[] = Array.isArray(raw.images)
    ? raw.images
        .filter(isExamStemImage)
        .map((img: any) => ({
          type: 'stem' as const,
          localPath: img.local_path || img.localPath,
          sha256: img.sha256,
          sourceUrl: img.source_url || img.sourceUrl
        }))
    : [];

  const codeBlocks: QuestionCodeBlock[] = Array.isArray(raw.code_blocks)
    ? raw.code_blocks
        .map(normalizeStemCodeBlock)
        .filter((cb): cb is QuestionCodeBlock => cb !== null)
    : [];

  const sanitized: SanitizedCaseQuestion = {
    id: raw.id,
    standardId: raw.standard_id || raw.standardId || raw.id,
    paperId: raw.paper_id || raw.paperId,
    groupOrder: Number(raw.group_order || raw.groupOrder || 0),
    subject: 'case',
    caseTitle: raw.case_title || raw.caseTitle || raw.title || '',
    chapter: raw.chapter || '未分类',
    sourceAnchor: raw.source_anchor || raw.sourceAnchor || '',
    sharedStem: raw.shared_stem || raw.sharedStem || '',
    subQuestions: resolveCaseSubquestions(raw).map((sub: any, index: number) => {
      const subImages = Array.isArray(sub.images)
        ? sub.images.map(normalizeStemAsset).filter((img): img is QuestionAsset => img !== null)
        : [];
      const subCodeBlocks = Array.isArray(sub.code_blocks || sub.codeBlocks)
        ? (sub.code_blocks || sub.codeBlocks).map(normalizeStemCodeBlock).filter((cb: QuestionCodeBlock | null): cb is QuestionCodeBlock => cb !== null)
        : [];
      return {
        id: sub.id || `sub${index + 1}`,
        title: sub.title || `【问题 ${index + 1}】`,
        stem: String(sub.stem || '').trim() === String(raw.shared_stem || '').trim() ? '' : String(sub.stem || ''),
        ...(subImages.length ? { images: subImages } : {}),
        ...(subCodeBlocks.length ? { codeBlocks: subCodeBlocks } : {})
      };
    }),
    codeBlocks,
    images
  };

  // Self-verification
  assertStrictAnswerIsolation(sanitized);
  return sanitized;
}

/**
 * Polymorphic question sanitizer.
 */
export function sanitizeQuestion(raw: any): SanitizedQuestion {
  if (raw.subject === 'case' || raw.shared_stem || raw.sharedStem) {
    return sanitizeCaseQuestion(raw);
  }
  return sanitizeObjectiveQuestion(raw);
}
