'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STANDARD_CHAPTERS } = require('../contracts');

/**
 * Synonym and domain concept dictionary for Ruankao Software Designer Exam (AC-Q3)
 */
const DOMAIN_SYNONYMS = {
  '两阶段锁': ['两段锁', '2PL', '两阶段加锁', '封锁协议', '并发控制', '可串行化'],
  '两段锁': ['两阶段锁', '2PL', '两阶段加锁', '封锁协议', '并发控制', '可串行化'],
  '2pl': ['两阶段锁', '两段锁', '两阶段加锁', '封锁协议', '并发控制'],
  '事务隔离': ['隔离级别', 'ACID', '脏读', '不可重复读', '幻读', '事务四大隔离级别', '并发控制'],
  'acid': ['事务', '原子性', '一致性', '隔离性', '持久性', '事务隔离'],
  '进程同步': ['PV操作', '信号量', '互斥', '临界区', '前趋图', '死锁', '进程管理'],
  'pv操作': ['信号量', '进程同步', '互斥', '临界区', '前趋图'],
  '信号量': ['PV操作', '进程同步', '互斥', '临界区', '前趋图'],
  '数据库并发': ['并发控制', '封锁机制', '排他锁', '共享锁', 'X锁', 'S锁', '三级封锁协议', '事务管理与并发控制体系'],
  '并发控制': ['封锁机制', '三级封锁协议', '两段锁协议', '事务隔离', '数据不一致'],
  '死锁': ['死锁预防', '死锁避免', '银行家算法', '死锁定理'],
  '基址寻址': ['寻址方式', '变址寻址', '基址寄存器', '有效地址', '指令系统'],
  '寻址方式': ['基址寻址', '变址寻址', '立即寻址', '直接寻址', '间接寻址', '寄存器寻址'],
  '流水线': ['吞吐率', '加速比', '流水线周期', '超标量', '流水线计算'],
  '海明码': ['校验码', '海明校验', 'CRC', '循环冗余校验', '奇偶校验'],
  '校验码': ['海明码', 'CRC', '循环冗余校验', '奇偶校验'],
  '设计模式': ['工厂模式', '单例模式', '观察者模式', '策略模式', '适配器模式', '面向对象设计模式'],
  '类图': ['UML类图', '面向对象分析', '泛化', '关联', '聚合', '组合', '依赖'],
  '数据流图': ['DFD', '0层图', '顶层图', '外部实体', '加工', '数据字典'],
  'dfd': ['数据流图', '外部实体', '数据流', '加工', '数据存储']
};

/**
 * Local Knowledge Base Material Retriever
 * Searches standard 21 canonical chapters for accurate heading & content matches.
 */
class LocalMaterialRetriever {
  /**
   * @param {object} [options]
   * @param {string} [options.materialsDir] Path to 软件设计师复习材料 directory
   * @param {number} [options.maxSnippetChars=1500] Maximum characters for combined retrieval snippets
   */
  constructor(options = {}) {
    this.fixtureDir = path.resolve(__dirname, '../../fixtures/materials');
    this.materialsDir = options.materialsDir || process.env.RUANKAO_MATERIALS_DIR || path.resolve(__dirname, '../../../../软件设计师复习材料');
    this.maxSnippetChars = options.maxSnippetChars || 1500;
  }

  /**
   * Resolves document path with graceful fallback to fixture directory if primary is inaccessible.
   * @param {string} relDocPath 
   * @returns {string}
   */
  resolveDocPath(relDocPath) {
    const primary = path.resolve(this.materialsDir, relDocPath);
    try {
      if (fs.existsSync(primary)) return primary;
    } catch {}
    if (this.fixtureDir) {
      const fallback = path.resolve(this.fixtureDir, relDocPath);
      try {
        if (fs.existsSync(fallback)) return fallback;
      } catch {}
    }
    return primary;
  }

  /**
   * Tokenizes text and expands with domain synonyms.
   * @param {string} text 
   * @returns {string[]}
   */
  expandQueryTerms(text) {
    if (!text || typeof text !== 'string') return [];
    const normalized = text.toLowerCase();
    const terms = new Set();

    // 1. Direct regex tokenization of keywords
    const matches = normalized.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9_\-\+]+/gi) || [];
    for (const m of matches) {
      terms.add(m);
    }

    // 2. Expand known synonyms
    for (const [key, synList] of Object.entries(DOMAIN_SYNONYMS)) {
      if (normalized.includes(key.toLowerCase())) {
        terms.add(key.toLowerCase());
        for (const s of synList) {
          terms.add(s.toLowerCase());
        }
      }
    }

    return Array.from(terms);
  }

  /**
   * Parses markdown file into sections delimited by #, ##, or ###.
   * @param {string} fullPath 
   * @param {string} relDocPath 
   * @param {object} chapterInfo 
   * @returns {Array<object>}
   */
  parseMarkdownSections(fullPath, relDocPath, chapterInfo) {
    if (!fs.existsSync(fullPath)) return [];
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      return [];
    }

    const lines = content.split('\n');
    const sections = [];
    let currentHeading = chapterInfo.name;
    let currentLevel = 1;
    let currentLines = [];

    const flushSection = () => {
      const sectionText = currentLines.join('\n').trim();
      if (sectionText.length > 0 || currentHeading !== chapterInfo.name) {
        sections.push({
          chapterKey: chapterInfo.key,
          chapterName: chapterInfo.name,
          subject: chapterInfo.subject,
          docPath: relDocPath,
          heading: currentHeading,
          level: currentLevel,
          content: sectionText,
          rawHeading: currentHeading
        });
      }
      currentLines = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        flushSection();
        currentLevel = headingMatch[1].length;
        currentHeading = headingMatch[2].trim();
      } else {
        currentLines.push(line);
      }
    }
    flushSection();

    return sections;
  }

  /**
   * Loads all sections across the canonical 21 chapters.
   * @returns {Array<object>}
   */
  loadAllSections() {
    const allSections = [];
    for (const chapter of STANDARD_CHAPTERS) {
      const fullPath = this.resolveDocPath(chapter.docPath);
      const sections = this.parseMarkdownSections(fullPath, chapter.docPath, chapter);
      allSections.push(...sections);
    }
    return allSections;
  }

  /**
   * Scores and retrieves relevant knowledge base sections for a query and context.
   * Supports multi-keyword and cross-chapter queries (AC-Q3).
   * 
   * @param {object} params
   * @param {string} params.query User question or search query
   * @param {object} [params.context] Additional context (chapter, stem, etc.)
   * @param {number} [params.minScore=4] Minimum score threshold
   * @param {number} [params.topK=3] Maximum number of sections
   * @returns {{ citedAnchors: Array<{ chapter: string, heading: string, docPath: string, excerpt: string }>, contextSnippet: string, isSufficient: boolean }}
   */
  retrieve({ query, context = {}, minScore = 4, topK = 3 }) {
    const combinedSearchText = [
      query || '',
      context.title || '',
      context.chapter || '',
      context.questionStem || '',
      context.sharedStem || ''
    ].join(' ');

    const terms = this.expandQueryTerms(combinedSearchText);
    if (terms.length === 0) {
      return {
        citedAnchors: [],
        contextSnippet: '',
        isSufficient: false
      };
    }

    const allSections = this.loadAllSections();
    const scored = [];

    for (const sec of allSections) {
      let score = 0;
      const lowerHeading = sec.heading.toLowerCase();
      const lowerContent = sec.content.toLowerCase();
      const lowerChapter = sec.chapterName.toLowerCase();

      let matchedTermsCount = 0;

      for (const t of terms) {
        let termMatched = false;
        if (lowerHeading.includes(t)) {
          score += 15;
          termMatched = true;
        } else if (lowerChapter.includes(t)) {
          score += 8;
          termMatched = true;
        }

        if (lowerContent.includes(t)) {
          score += 3;
          termMatched = true;
        }

        if (termMatched) {
          matchedTermsCount++;
        }
      }

      // Multi-keyword coverage bonus (vital for cross-concept queries like "事务隔离与两阶段锁")
      if (matchedTermsCount >= 2) {
        score += matchedTermsCount * 10;
      }

      // Priority boost if chapter explicitly matches context
      if (context.chapter && lowerChapter.includes(context.chapter.toLowerCase())) {
        score += 5;
      }

      if (score >= minScore) {
        scored.push({
          section: sec,
          score,
          matchedTermsCount
        });
      }
    }

    if (scored.length === 0) {
      return {
        citedAnchors: [],
        contextSnippet: '',
        isSufficient: false
      };
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Support Cross-Chapter diversity:
    // If multiple chapters match strongly, ensure top sections from different chapters are included!
    const selectedSections = [];
    const chapterMap = new Map();

    for (const item of scored) {
      const cKey = item.section.chapterKey;
      if (!chapterMap.has(cKey)) {
        chapterMap.set(cKey, []);
      }
      chapterMap.get(cKey).push(item.section);
    }

    // Interleave top picks from each matched chapter to guarantee cross-chapter balance
    const chapters = Array.from(chapterMap.keys());
    let round = 0;
    while (selectedSections.length < topK && round < 3) {
      let addedInRound = false;
      for (const cKey of chapters) {
        const list = chapterMap.get(cKey);
        if (list && list[round]) {
          selectedSections.push(list[round]);
          addedInRound = true;
          if (selectedSections.length >= topK) break;
        }
      }
      if (!addedInRound) break;
      round++;
    }

    // Build citations and budget-controlled snippet
    const citedAnchors = [];
    const snippetParts = [];
    let currentLength = 0;

    for (const sec of selectedSections) {
      // Excerpt: take first ~350 chars of section or lines matching terms
      let excerpt = sec.content.slice(0, 350).trim();
      if (sec.content.length > 350) {
        excerpt += '...';
      }

      citedAnchors.push({
        chapter: sec.chapterName,
        heading: sec.heading,
        docPath: sec.docPath,
        excerpt
      });

      const sectionSnippet = `### [${sec.chapterName}] ${sec.heading} (${sec.docPath})\n${excerpt}\n`;
      if (currentLength + sectionSnippet.length <= this.maxSnippetChars) {
        snippetParts.push(sectionSnippet);
        currentLength += sectionSnippet.length;
      } else {
        const remaining = Math.max(50, this.maxSnippetChars - currentLength);
        snippetParts.push(sectionSnippet.slice(0, remaining) + '\n...(考点内容已根据预算截断)');
        break;
      }
    }

    return {
      citedAnchors,
      contextSnippet: snippetParts.join('\n\n'),
      isSufficient: true
    };
  }

  /**
   * Verifies an anchor against actual disk knowledge base files.
   * Prevents hallucinated or arbitrary paths from LLM (AC-Q3).
   * 
   * @param {string} docPath 
   * @param {string} heading 
   * @returns {boolean}
   */
  isValidAnchor(docPath, heading) {
    if (!docPath || !heading) return false;
    const fullPath = this.resolveDocPath(docPath);
    try {
      if (!fs.existsSync(fullPath)) return false;
      const content = fs.readFileSync(fullPath, 'utf8');
      return content.includes(heading.trim());
    } catch {
      return false;
    }
  }
}

module.exports = {
  LocalMaterialRetriever,
  DOMAIN_SYNONYMS
};
