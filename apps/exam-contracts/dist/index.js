"use strict";

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

function assertStrictAnswerIsolation(obj, path = 'root') {
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

function isExamStemImage(img) {
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

function normalizeStemAsset(img) {
  if (!isExamStemImage(img)) return null;
  return {
    type: 'stem',
    localPath: img.local_path || img.localPath,
    sha256: img.sha256,
    sourceUrl: img.source_url || img.sourceUrl
  };
}

function normalizeStemCodeBlock(cb) {
  if (!cb) return null;
  if (typeof cb === 'string') {
    return {
      type: 'stem',
      code: cb
    };
  }
  if (cb.type && cb.type !== 'stem') return null;
  return {
    type: 'stem',
    code: cb.code || cb.content || '',
    language: cb.language
  };
}

function sanitizeObjectiveQuestion(raw) {
  const images = Array.isArray(raw.images)
    ? raw.images
        .filter(isExamStemImage)
        .map((img) => ({
          type: 'stem',
          localPath: img.local_path || img.localPath,
          sha256: img.sha256,
          sourceUrl: img.source_url || img.sourceUrl
        }))
    : [];

  const codeBlocks = Array.isArray(raw.code_blocks)
    ? raw.code_blocks
        .map(normalizeStemCodeBlock)
        .filter((cb) => cb !== null)
    : [];

  const options = Array.isArray(raw.options)
    ? raw.options.map((opt) => {
        const key = String(opt.key).trim().toUpperCase();
        const assets = Array.isArray(opt.images) ? opt.images : (typeof opt.image === 'string' ? [{ type: 'stem', local_path: opt.image }] : []);
        const images = assets.filter((asset) => isExamStemImage(asset) && (!asset.owner || asset.owner === 'stem' || asset.owner === 'option:' + key)).map((asset) => ({
          type: 'stem',
          localPath: asset.local_path || asset.localPath,
          sha256: asset.sha256,
          sourceUrl: asset.source_url || asset.sourceUrl
        }));
        return { key, text: String(opt.text ?? ''), ...(images.length ? { images } : {}) };
      })
    : [];

  const sanitized = {
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

  assertStrictAnswerIsolation(sanitized);
  return sanitized;
}

function resolveCaseSubquestions(raw) {
  const explicit = raw.subquestions || raw.subQuestions;
  if (Array.isArray(explicit) && explicit.length) return explicit;

  // Only standalone headings are boundaries: references inside a question,
  // numbered requirements and code blanks must not create extra answer fields.
  const stem = String(raw.shared_stem || raw.sharedStem || '');
  const headings = [];
  let offset = 0;
  let fence = '';
  const digits = (value) => value.replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10));
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

function sanitizeCaseQuestion(raw) {
  const images = Array.isArray(raw.images)
    ? raw.images
        .filter(isExamStemImage)
        .map((img) => ({
          type: 'stem',
          localPath: img.local_path || img.localPath,
          sha256: img.sha256,
          sourceUrl: img.source_url || img.sourceUrl
        }))
    : [];

  const codeBlocks = Array.isArray(raw.code_blocks)
    ? raw.code_blocks
        .map(normalizeStemCodeBlock)
        .filter((cb) => cb !== null)
    : [];

  const sanitized = {
    id: raw.id,
    standardId: raw.standard_id || raw.standardId || raw.id,
    paperId: raw.paper_id || raw.paperId,
    groupOrder: Number(raw.group_order || raw.groupOrder || 0),
    subject: 'case',
    caseTitle: raw.case_title || raw.caseTitle || raw.title || '',
    chapter: raw.chapter || '未分类',
    sourceAnchor: raw.source_anchor || raw.sourceAnchor || '',
    sharedStem: raw.shared_stem || raw.sharedStem || '',
    subQuestions: resolveCaseSubquestions(raw).map((sub, index) => {
      const subImages = Array.isArray(sub.images)
        ? sub.images
            .map(normalizeStemAsset)
            .filter((img) => img !== null)
        : [];
      const subCodeBlocks = Array.isArray(sub.code_blocks || sub.codeBlocks)
        ? (sub.code_blocks || sub.codeBlocks)
            .map(normalizeStemCodeBlock)
            .filter((cb) => cb !== null)
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

  assertStrictAnswerIsolation(sanitized);
  return sanitized;
}

function sanitizeQuestion(raw) {
  if (raw.subject === 'case' || raw.shared_stem || raw.sharedStem) {
    return sanitizeCaseQuestion(raw);
  }
  return sanitizeObjectiveQuestion(raw);
}

function gradeObjectiveQuestion(questionId, userAnswer, effectiveAnswer, pointWeight = 1) {
  const normUser = (userAnswer || '').trim().toUpperCase();
  const normTarget = (effectiveAnswer || '').trim().toUpperCase();

  if (normUser.length === 0) {
    return {
      questionId,
      userAnswer: '',
      effectiveAnswer: normTarget,
      isCorrect: null,
      score: null,
      maxScore: pointWeight,
      status: 'unanswered'
    };
  }

  const isCorrect = normUser === normTarget;
  const score = isCorrect ? pointWeight : 0;

  return {
    questionId,
    userAnswer: normUser,
    effectiveAnswer: normTarget,
    isCorrect,
    score,
    maxScore: pointWeight,
    status: isCorrect ? 'correct' : 'wrong'
  };
}

function validateCaseScoreResult(result, defaultMaxPoints = 15) {
  const maxPoints = typeof result.maxPoints === 'number' && result.maxPoints > 0
    ? result.maxPoints
    : defaultMaxPoints;

  let points = typeof result.points === 'number' ? result.points : 0;
  let needsHumanReview = Boolean(result.needsHumanReview);

  if (points < 0) {
    points = 0;
    needsHumanReview = true;
  }
  if (points > maxPoints) {
    points = maxPoints;
    needsHumanReview = true;
  }

  const breakdown = Array.isArray(result.breakdown)
    ? result.breakdown.map((b, idx) => ({
        subQuestionIndex: b.subQuestionIndex ?? idx + 1,
        subQuestionTitle: b.subQuestionTitle || `问题${idx + 1}`,
        points: Math.max(0, Math.min(b.points ?? 0, b.maxPoints ?? 4)),
        maxPoints: b.maxPoints ?? 4,
        feedback: b.feedback || '',
        reason: b.reason
      }))
    : [];

  return {
    questionId: result.questionId || 'unknown',
    evaluatorType: result.evaluatorType || 'rule',
    points,
    maxPoints,
    feedback: result.feedback || '评分完成',
    breakdown,
    needsHumanReview,
    humanOverridePoints: result.humanOverridePoints ?? null,
    humanNotes: result.humanNotes ?? null
  };
}

const EXAM_OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Ruankao Local Exam Web Service API',
    version: '1.0.0',
    description: 'Local 127.0.0.1 bound REST service for Ruankao exam preparation.'
  }
};

const STANDARD_CHAPTERS = [
  // 13 Objective Chapters
  { key: 'obj_01_computer_system', name: '计算机系统知识', subject: 'objective', docPath: '选择题/01-计算机系统知识.md', order: 1 },
  { key: 'obj_02_pl_basics', name: '程序设计语言基础知识', subject: 'objective', docPath: '选择题/02-程序设计语言基础知识.md', order: 2 },
  { key: 'obj_03_data_structure', name: '数据结构', subject: 'objective', docPath: '选择题/03-数据结构.md', order: 3 },
  { key: 'obj_04_os', name: '操作系统知识', subject: 'objective', docPath: '选择题/04-操作系统知识.md', order: 4 },
  { key: 'obj_05_software_eng', name: '软件工程基础知识', subject: 'objective', docPath: '选择题/05-软件工程基础知识.md', order: 5 },
  { key: 'obj_06_structured_dev', name: '结构化开发方法', subject: 'objective', docPath: '选择题/06-结构化开发方法.md', order: 6 },
  { key: 'obj_07_oo_tech', name: '面向对象技术', subject: 'objective', docPath: '选择题/07-面向对象技术.md', order: 7 },
  { key: 'obj_08_algorithm', name: '算法设计与分析', subject: 'objective', docPath: '选择题/08-算法设计与分析.md', order: 8 },
  { key: 'obj_09_database', name: '数据库技术基础', subject: 'objective', docPath: '选择题/09-数据库技术基础.md', order: 9 },
  { key: 'obj_10_network_security', name: '网络与信息安全基础知识', subject: 'objective', docPath: '选择题/10-网络与信息安全基础知识.md', order: 10 },
  { key: 'obj_11_ip_standards', name: '标准化和软件知识产权基础知识', subject: 'objective', docPath: '选择题/11-标准化和软件知识产权基础知识.md', order: 11 },
  { key: 'obj_12_sys_analysis_design', name: '软件系统分析与设计', subject: 'objective', docPath: '选择题/12-软件系统分析与设计.md', order: 12 },
  { key: 'obj_13_english', name: '英语', subject: 'objective', docPath: '选择题/13-英语.md', order: 13 },

  // 8 Case Chapters
  { key: 'case_01_dfd', name: '结构化分析与设计', subject: 'case', docPath: '案例题/01-结构化分析与设计.md', order: 14 },
  { key: 'case_02_design_patterns', name: '面向对象设计模式与C++/Java实现', subject: 'case', docPath: '案例题/02-面向对象设计模式与Java实现.md', order: 15 },
  { key: 'case_03_uml_class', name: 'UML类图与面向对象分析', subject: 'case', docPath: '案例题/03-UML类图与面向对象分析.md', order: 16 },
  { key: 'case_04_db_design', name: '数据库设计与关系模式', subject: 'case', docPath: '案例题/04-数据库设计与关系模式.md', order: 17 },
  { key: 'case_05_uml_usecase', name: 'UML用例图与活动图', subject: 'case', docPath: '案例题/05-UML用例图与活动图.md', order: 18 },
  { key: 'case_06_uml_sequence', name: 'UML序列图与关系', subject: 'case', docPath: '案例题/06-UML序列图与关系.md', order: 19 },
  { key: 'case_07_uml_state', name: 'UML状态图与状态转换', subject: 'case', docPath: '案例题/07-UML状态图与状态转换.md', order: 20 },
  { key: 'case_08_algorithm_case', name: '算法设计与分析(案例)', subject: 'case', docPath: '案例题/08-算法设计与分析.md', order: 21 }
];

function resolveStandardChapter(target) {
  if (!target) return STANDARD_CHAPTERS[0];
  let text = '';
  let isCase = false;
  if (typeof target === 'string') {
    text = target;
    isCase = target.startsWith('case_') || target.includes('案例');
  } else if (typeof target === 'object') {
    isCase = target.subject === 'case' || Boolean(target.shared_stem || target.sharedStem || target.case_title || target.caseTitle);
    text = `${target.chapter || ''} ${target.case_title || target.caseTitle || ''} ${target.shared_stem || target.sharedStem || ''} ${target.questionStem || ''}`;
    if (target.chapterKey) {
      const match = STANDARD_CHAPTERS.find(c => c.key === target.chapterKey);
      if (match) return match;
    }
  }

  // Exact key match
  const directKeyMatch = STANDARD_CHAPTERS.find(c => c.key === text.trim());
  if (directKeyMatch) return directKeyMatch;

  if (isCase) {
    // Strong title/declared-language evidence precedes incidental vocabulary
    // such as "分支" or design-pattern names in an algorithm's explanation.
    const title = typeof target === 'object' ? `${target.case_title || target.caseTitle || ''} ${target.questionStem || ''}` : text;
    if (/(n\s*皇后|二叉排序树|二叉查找树|C\s*(?:程序|语言|代码).*算法|动态规划|哈密尔顿|矩阵链乘)/i.test(title) && !/(Java|C\+\+)/i.test(title))
      return STANDARD_CHAPTERS.find(c => c.key === 'case_08_algorithm_case');
    if (/(Java|C\+\+)/i.test(title)) return STANDARD_CHAPTERS.find(c => c.key === 'case_02_design_patterns');
    if (/(数据流图|DFD|0层图|顶层图|外部实体|加工逻辑|数据字典)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_01_dfd');
    if (/(数据库|关系模式|E-R|实体联系|范式|主键|外键|1NF|2NF|3NF|BCNF)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_04_db_design');
    if (/(用例图|活动图|参与者|包含关系|扩展关系|泳道|分支)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_05_uml_usecase');
    if (/(序列图|时序图|顺序图|通信图|生命线|激活期|消息)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_06_uml_sequence');
    if (/(状态图|状态转换|初始状态|终止状态|转换条件|事件)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_07_uml_state');
    if (/(设计模式|Java|C\+\+|面向对象设计模式|单例|工厂|观察者|策略模式|策略（Strategy）|适配器|装饰器)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_02_design_patterns');
    if (/(算法|动态规划|分治|贪心|回溯|分支限界|时间复杂度|n皇后)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_08_algorithm_case');
    if (/(类图|面向对象分析|泛化|关联|聚合|组合|实现关系)/i.test(text)) return STANDARD_CHAPTERS.find(c => c.key === 'case_03_uml_class');
    return STANDARD_CHAPTERS.find(c => c.key === 'case_01_dfd');
  }

  // Objective matching
  const clean = text.split('·')[0].trim();
  if (/(体系结构|计算机系统|流水线|Cache|指令系统|RISC|CISC|校验码|海明码|CRC)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_01_computer_system');
  if (/(程序设计语言|编译|文法|正规式|有限自动机|语法树|语义分析|作用域)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_02_pl_basics');
  if (/(数据结构|线性表|链表|栈|队列|二叉树|树|哈希表|散列表|图)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_03_data_structure');
  if (/(操作系统|进程|死锁|PV操作|信号量|页面置换|段页式|文件系统|设备驱动)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_04_os');
  if (/(软件工程|瀑布|敏捷|原型|螺旋|能力成熟度|CMMI|测试|黑盒|白盒|维护)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_05_software_eng');
  if (/(结构化开发|DFD|数据流|模块化|内聚|耦合|结构化设计)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_06_structured_dev');
  if (/(面向对象技术|面向对象|封装|继承|多态|UML|设计模式)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_07_oo_tech');
  if (/(算法设计与分析|算法|时空复杂度|排序|查找|贪心|动态规划)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_08_algorithm');
  if (/(数据库|关系代数|SQL|规范化|事务|ACID|并发控制|锁)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_09_database');
  if (/(网络|信息安全|OSI|TCP|IP|路由|DNS|HTTP|加密|RSA|DES|数字签名|证书|防火墙)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_10_network_security');
  if (/(知识产权|标准化|著作权|专利|商标|商业秘密|国家标准|ISO)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_11_ip_standards');
  if (/(系统分析与设计|软件系统分析|体系结构设计|性能评估)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_12_sys_analysis_design');
  if (/(英语|English|专业英语)/i.test(clean)) return STANDARD_CHAPTERS.find(c => c.key === 'obj_13_english');

  return STANDARD_CHAPTERS[0];
}

function ensurePureUnicodeFormulas(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  // Replace LaTeX macros with standard Unicode
  const REPLACEMENTS = [
    [/\\times/g, '×'],
    [/\\div/g, '÷'],
    [/\\pm/g, '±'],
    [/\\leq/g, '≤'],
    [/\\le\b/g, '≤'],
    [/\\geq/g, '≥'],
    [/\\ge\b/g, '≥'],
    [/\\neq/g, '≠'],
    [/\\ne\b/g, '≠'],
    [/\\approx/g, '≈'],
    [/\\in/g, '∈'],
    [/\\notin/g, '∉'],
    [/\\subset/g, '⊂'],
    [/\\subseteq/g, '⊆'],
    [/\\cap/g, '∩'],
    [/\\cup/g, '∪'],
    [/\\sum/g, '∑'],
    [/\\prod/g, '∏'],
    [/\\sqrt\{([^}]+)\}/g, '√($1)'],
    [/\\sqrt/g, '√'],
    [/\\infty/g, '∞'],
    [/\\rightarrow/g, '→'],
    [/\\leftarrow/g, '←'],
    [/\\to/g, '→'],
    [/\\alpha/g, 'α'],
    [/\\beta/g, 'β'],
    [/\\gamma/g, 'γ'],
    [/\\delta/g, 'δ'],
    [/\\lambda/g, 'λ'],
    [/\\pi/g, 'π'],
    [/\\sigma/g, 'σ'],
    [/\\mu/g, 'μ'],
    [/\\theta/g, 'θ'],
    [/\\cdot/g, '·'],
    [/\\log_2/g, 'log₂'],
    [/\\log_\{?2\}?/g, 'log₂'],
    [/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)'],
    [/\^2\b/g, '²'],
    [/\^3\b/g, '³'],
    [/_0\b/g, '₀'],
    [/_1\b/g, '₁'],
    [/_2\b/g, '₂'],
    [/_3\b/g, '₃'],
    [/_n\b/g, 'ₙ']
  ];

  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  // Remove any remaining raw LaTeX math delimiters ($...$, $$...$$)
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
  out = out.replace(/\$([^\$\n]+)\$/g, '$1');

  return out;
}

function sanitizeMarkdownContent(markdown) {
  if (typeof markdown !== 'string') return '';
  let cleaned = markdown;

  // 1. Remove dangerous script and style tags completely
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  cleaned = cleaned.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

  // 2. Remove dangerous protocol links: javascript:, vbscript:, data:
  cleaned = cleaned.replace(/\[([^\]]*)\]\((?:javascript|vbscript|data):[^\)]*\)/gi, '[$1](#)');

  // 3. Strip inline on* handlers from any stray HTML tags
  cleaned = cleaned.replace(/<([a-z1-6]+)\s+[^>]*on[a-z]+\s*=[^>]*>/gi, '<$1>');

  // 4. Ensure pure Unicode formulas
  cleaned = ensurePureUnicodeFormulas(cleaned);

  return cleaned.trim();
}

function validateChatRequest(req) {
  if (!req || typeof req !== 'object') {
    throw new Error('Chat request must be an object');
  }
  if (!req.context || typeof req.context !== 'object') {
    throw new Error('Chat request context is required');
  }
  const validContextTypes = ['question', 'material', 'report', 'general'];
  if (!validContextTypes.includes(req.context.type)) {
    throw new Error(`Invalid context type: ${req.context.type}. Must be one of: ${validContextTypes.join(', ')}`);
  }
  if (!req.context.title || typeof req.context.title !== 'string') {
    throw new Error('Chat request context title is required');
  }
  if (typeof req.userMessage !== 'string' || req.userMessage.trim().length === 0) {
    throw new Error('userMessage must be a non-empty string');
  }
  if (req.userMessage.length > 500) {
    throw new Error(`userMessage exceeds maximum length of 500 characters (length: ${req.userMessage.length})`);
  }
  if (req.history && !Array.isArray(req.history)) {
    throw new Error('history must be an array of messages');
  }
  if (req.history && req.history.length > 10) {
    req.history = req.history.slice(-10);
  }
  return true;
}

function calculateEffectiveMaxScore(totalQuestions, subject = 'objective', isFullPaper = true) {
  if (subject === 'case') {
    if (isFullPaper && totalQuestions === 6) {
      return 75;
    }
    return totalQuestions * 15;
  }
  return totalQuestions;
}

function resolveCaseElectiveSelection(q5, q6, answersMap, explicitSelectedId) {
  const getAns = (id) => {
    if (answersMap instanceof Map) return answersMap.get(id);
    return answersMap ? answersMap[id] : undefined;
  };

  const isPopulated = (val) => {
    if (val === null || val === undefined) return false;
    const ans = val && typeof val === 'object' && 'userAnswer' in val ? val.userAnswer : val;
    if (typeof ans === 'string') return ans.trim().length > 0;
    if (typeof ans === 'object') {
      return Object.values(ans).some((v) => v && String(v).trim().length > 0);
    }
    return Boolean(ans);
  };

  const ans5Populated = isPopulated(getAns(q5.id));
  const ans6Populated = isPopulated(getAns(q6.id));
  const hasBothAnswered = ans5Populated && ans6Populated;
  const hasNeitherAnswered = !ans5Populated && !ans6Populated;

  if (explicitSelectedId === q5.id) {
    return {
      selectedId: q5.id,
      unselectedId: q6.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'explicit_selection_q5'
    };
  }
  if (explicitSelectedId === q6.id) {
    return {
      selectedId: q6.id,
      unselectedId: q5.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'explicit_selection_q6'
    };
  }

  if (ans5Populated && !ans6Populated) {
    return {
      selectedId: q5.id,
      unselectedId: q6.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'single_answered_q5'
    };
  }
  if (!ans5Populated && ans6Populated) {
    return {
      selectedId: q6.id,
      unselectedId: q5.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'single_answered_q6'
    };
  }

  // If both answered, default to Q5 (first in paper order, never silently taking highest score)
  if (hasBothAnswered) {
    return {
      selectedId: q5.id,
      unselectedId: q6.id,
      hasBothAnswered: true,
      hasNeitherAnswered: false,
      selectedReason: 'both_answered_default_q5'
    };
  }

  // Neither answered, default to Q5 as standard tracked slot
  return {
    selectedId: q5.id,
    unselectedId: q6.id,
    hasBothAnswered: false,
    hasNeitherAnswered: true,
    selectedReason: 'neither_answered_default_q5'
  };
}

module.exports = {
  FORBIDDEN_LEAK_KEYS,
  assertStrictAnswerIsolation,
  sanitizeObjectiveQuestion,
  sanitizeCaseQuestion,
  sanitizeQuestion,
  gradeObjectiveQuestion,
  validateCaseScoreResult,
  calculateEffectiveMaxScore,
  resolveCaseElectiveSelection,
  EXAM_OPENAPI_SPEC,
  STANDARD_CHAPTERS,
  resolveStandardChapter,
  ensurePureUnicodeFormulas,
  sanitizeMarkdownContent,
  validateChatRequest
};


