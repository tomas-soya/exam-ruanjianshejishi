'use strict';

const {
  ensurePureUnicodeFormulas,
  sanitizeMarkdownContent
} = require('../../../exam-contracts/dist/index.js');

/**
 * Personal Materials Sanitizer (AC-1, AC-2, AC-4, AC-5)
 * Sanitizes LLM generated Markdown, cancels artificial caps, and enforces clean point structure:
 * - Cancels 5-point, 600-char, and 90-char limits (AC-1, AC-4)
 * - Complete coverage of all different scoring points without artificial truncation (AC-1)
 * - Preserves necessary decision conditions, formulas, steps without chopping (AC-4)
 * - Pure Unicode formulas, strips XSS, strips IDs
 * - Deduplication across identical points while preserving different applicable conditions (AC-2)
 * - Extracts structured summary metrics
 */

function cleanSinglePoint(text) {
  if (!text || typeof text !== 'string') return '';
  let point = text.trim();
  // Strip leading list bullets, numbering, or checkboxes
  point = point.replace(/^[-*•]\s*/, '').replace(/^\d+[\.、）\)]\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();

  // Strip empty/placeholder lines
  if (
    !point ||
    point.includes('待后续练习积累更多答题实测证据进行细化') ||
    point.includes('暂无') ||
    point.includes('本次作答全部正确') ||
    point === '无'
  ) {
    return '';
  }

  // Strip markdown bold markers from points
  point = point.replace(/\*\*/g, '');

  // Normalize tag format if separated by colon
  if (!point.startsWith('【') && !point.startsWith('[')) {
    const colonIdx = point.indexOf('：') !== -1 ? point.indexOf('：') : point.indexOf(':');
    if (colonIdx > 0 && colonIdx <= 20) {
      const tag = point.slice(0, colonIdx).trim();
      const rest = point.slice(colonIdx + 1).trim();
      point = `【${tag}】${rest}`;
    }
  }

  // AC-1 & AC-4: Keep the full point intact; never drop or chop based on 90-char limit
  return point;
}

function sanitizeGeneratedMarkdown(rawMarkdown, chapterName = '') {
  if (typeof rawMarkdown !== 'string') {
    return {
      markdown: '',
      summary: { weakPointsCount: 0, misconceptionsCount: 0, tipsCount: 0, checklistsCount: 0 }
    };
  }

  // 1. Strip markdown fences if LLM wrapped full text in ```markdown ... ```
  let text = rawMarkdown.trim();
  text = text.replace(/^```(?:markdown|md)?\s*[\r\n]+/i, '').replace(/[\r\n]+```\s*$/i, '');

  // 2. Base sanitation: remove scripts, iframes, unsafe protocols, LaTeX formulas
  text = sanitizeMarkdownContent(text);

  // 3. Remove accidental raw question IDs (e.g. oq-735cd504c67854131204 or ruankao-sd-*)
  text = text.replace(/\b(?:(?:oq|cg|ref)-[a-f0-9]{20}|sd-\d{4}-(?:\d{2}|unknown)-(?:objective|case)-[a-f0-9]{10})\b/gi, '相关历年考题');
  text = text.replace(/ruankao-[a-z0-9\-_]+/gi, '相关认证真题');

  // 4. Extract points and deduplicate
  const lines = text.split('\n');
  const rawPoints = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect list items or numbered items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+[\.、）\)]/.test(trimmed)) {
      const cleaned = cleanSinglePoint(trimmed);
      if (cleaned) {
        rawPoints.push(cleaned);
      }
    }
  }

  // Fallback: If LLM didn't use bullet prefix but wrote lines
  if (rawPoints.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;
      const cleaned = cleanSinglePoint(trimmed);
      if (cleaned && cleaned.length >= 8) {
        rawPoints.push(cleaned);
      }
    }
  }

  // Deduplicate identical points while preserving points with different conditions (AC-2)
  const seen = new Set();
  const dedupedPoints = [];
  for (const p of rawPoints) {
    // Normalization key for deduplication
    const key = p.replace(/[【】\[\]\s，。；、]/g, '').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      dedupedPoints.push(p);
    }
  }

  // AC-1: No artificial 5-point limit; complete coverage of all unique points
  const selectedPoints = dedupedPoints;

  const cleanChapterName = (chapterName || '').replace(/^【|】$/g, '').trim() || '重点章节';
  const title = `# 【错题复习要点】${cleanChapterName}`;

  let finalMarkdown = '';
  if (selectedPoints.length > 0) {
    finalMarkdown = `${title}\n\n${selectedPoints.map(p => `- ${p}`).join('\n')}`;
  } else {
    // No valid points
    finalMarkdown = `${title}\n\n（暂无有效错题复习要点）`;
  }

  // Summary metrics (compatible with PersonalMaterialSummary contract)
  const count = selectedPoints.length;
  let summary = {
    weakPointsCount: count,
    misconceptionsCount: count > 0 ? Math.max(1, selectedPoints.filter(i => /易错|混淆|误|陷阱|盲区|失误|不当|切勿|避免/.test(i)).length || count) : 0,
    tipsCount: count > 0 ? Math.max(1, selectedPoints.filter(i => /口诀|技巧|Tips|注意|建议|应当|公式|规则/.test(i)).length || count) : 0,
    checklistsCount: count > 0 ? Math.max(1, selectedPoints.filter(i => /检查|自查|步骤|核对|清单|确认/.test(i)).length || count) : 0
  };

  return {
    markdown: finalMarkdown,
    points: selectedPoints,
    summary
  };
}

module.exports = {
  cleanSinglePoint,
  sanitizeGeneratedMarkdown
};
