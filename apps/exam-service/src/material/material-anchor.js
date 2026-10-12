'use strict';

/**
 * Material Anchor Resolver
 * 
 * Maps exam chapters and topics to standardized review materials
 * in '软件设计师复习材料/*.md'.
 * 
 * Guarantees zero external rendering dependencies (pure Markdown headings)
 * and conforms strictly to the MaterialAnchor interface from @ruankao/exam-contracts.
 */

const CHAPTER_ANCHOR_MAP = {
  // 1. 计算机组成与体系结构
  '计算机组成与体系结构': {
    relativeDocPath: '软件设计师复习材料/01_计算机系统与体系结构.md',
    anchorHeading: '# 计算机系统与体系结构',
    topic: '计算机系统知识'
  },
  '计算机系统知识': {
    relativeDocPath: '软件设计师复习材料/01_计算机系统与体系结构.md',
    anchorHeading: '# 计算机系统与体系结构',
    topic: '计算机系统知识'
  },

  // 2. 程序设计语言基础
  '程序设计语言基础': {
    relativeDocPath: '软件设计师复习材料/02_程序设计语言基础.md',
    anchorHeading: '# 程序设计语言基础',
    topic: '编译与程序设计语言'
  },
  '程序设计语言基础知识': {
    relativeDocPath: '软件设计师复习材料/02_程序设计语言基础.md',
    anchorHeading: '# 程序设计语言基础',
    topic: '编译与程序设计语言'
  },

  // 3. 数据结构与算法
  '数据结构': {
    relativeDocPath: '软件设计师复习材料/03_数据结构与算法.md',
    anchorHeading: '# 数据结构与算法',
    topic: '线性表、树与图'
  },
  '算法基础': {
    relativeDocPath: '软件设计师复习材料/03_数据结构与算法.md',
    anchorHeading: '# 算法设计与分析',
    topic: '常用算法与时空复杂度'
  },
  '数据结构与算法': {
    relativeDocPath: '软件设计师复习材料/03_数据结构与算法.md',
    anchorHeading: '# 数据结构与算法',
    topic: '核心数据结构与算法'
  },

  // 4. 操作系统
  '操作系统': {
    relativeDocPath: '软件设计师复习材料/04_操作系统.md',
    anchorHeading: '# 操作系统',
    topic: '进程、存储、文件与设备管理'
  },
  '操作系统知识': {
    relativeDocPath: '软件设计师复习材料/04_操作系统.md',
    anchorHeading: '# 操作系统',
    topic: '进程、存储、文件与设备管理'
  },

  // 5. 软件工程与系统开发
  '系统开发基础': {
    relativeDocPath: '软件设计师复习材料/05_软件工程与系统开发.md',
    anchorHeading: '# 软件工程与系统开发',
    topic: '开发模型、测试与维护'
  },
  '软件工程': {
    relativeDocPath: '软件设计师复习材料/05_软件工程与系统开发.md',
    anchorHeading: '# 软件工程与系统开发',
    topic: '开发模型、测试与维护'
  },

  // 6. 面向对象技术
  '面向对象技术': {
    relativeDocPath: '软件设计师复习材料/06_面向对象技术.md',
    anchorHeading: '# 面向对象技术',
    topic: 'UML与设计模式'
  },

  // 7. 数据库系统
  '数据库系统': {
    relativeDocPath: '软件设计师复习材料/07_数据库系统.md',
    anchorHeading: '# 数据库系统',
    topic: '关系代数、SQL、规范化与事务'
  },
  '数据库技术': {
    relativeDocPath: '软件设计师复习材料/07_数据库系统.md',
    anchorHeading: '# 数据库系统',
    topic: '关系代数、SQL、规范化与事务'
  },

  // 8. 网络与信息安全
  '计算机网络': {
    relativeDocPath: '软件设计师复习材料/08_网络与信息安全.md',
    anchorHeading: '# 计算机网络体系结构',
    topic: 'TCP/IP与网络协议'
  },
  '信息安全': {
    relativeDocPath: '软件设计师复习材料/08_网络与信息安全.md',
    anchorHeading: '# 网络与信息安全',
    topic: '密码学与安全防御'
  },
  '网络与信息安全': {
    relativeDocPath: '软件设计师复习材料/08_网络与信息安全.md',
    anchorHeading: '# 网络与信息安全',
    topic: '网络架构与安全攻防'
  },

  // 9. 知识产权与标准化
  '知识产权与标准化': {
    relativeDocPath: '软件设计师复习材料/09_知识产权与标准化.md',
    anchorHeading: '# 知识产权与标准化',
    topic: '著作权、专利权与标准化'
  },
  '标准化与知识产权': {
    relativeDocPath: '软件设计师复习材料/09_知识产权与标准化.md',
    anchorHeading: '# 知识产权与标准化',
    topic: '著作权、专利权与标准化'
  },

  // 10. 多媒体基础
  '多媒体基础': {
    relativeDocPath: '软件设计师复习材料/10_多媒体技术.md',
    anchorHeading: '# 多媒体技术',
    topic: '多媒体压缩与标准'
  },

  // 11. 项目管理与专业英语
  '项目管理': {
    relativeDocPath: '软件设计师复习材料/11_项目管理与专业英语.md',
    anchorHeading: '# 项目管理基础',
    topic: '进度、成本与质量管理'
  },
  '专业英语': {
    relativeDocPath: '软件设计师复习材料/11_项目管理与专业英语.md',
    anchorHeading: '# 计算机专业英语核心词汇',
    topic: '计算机专业英语'
  }
};

const CASE_TOPIC_ANCHORS = [
  // 1. Topic 1: Structured Analysis & Design (DFD)
  {
    topicId: 1,
    pattern: /(数据流图|DFD|0层图|顶层图|外部实体|加工逻辑|数据字典)/i,
    anchor: {
      relativeDocPath: '软件设计师复习材料/案例_专题1_数据流图DFD.md',
      anchorHeading: '# 结构化分析与设计案例：数据流图（DFD）',
      topic: '数据流图分析与设计'
    }
  },
  // 2. Topic 4: Algorithm Design & Analysis (Prioritized to avoid matching generic strategies in design patterns)
  {
    topicId: 4,
    pattern: /(?:算法基础|C程序|C代码|贪心策略|分治策略|动态规划|回溯|分支限界|时间复杂度|二叉排序树|矩阵链乘|0-1背包|Hamilton回路)/i,
    anchor: {
      relativeDocPath: '软件设计师复习材料/案例_专题4_算法设计与分析.md',
      anchorHeading: '# 算法设计与分析案例',
      topic: '算法设计与分析'
    }
  },
  // 3. Topic 5: Object-Oriented Design Patterns & Java/C++ Implementation
  // Must precede UML modeling because design pattern stems regularly reference class diagrams (e.g. '给出类图')
  {
    topicId: 5,
    pattern: /(?:(?:阅读|编写)?(?:Java|C\+\+|C＋＋)(?:代码|程序|填空)|设计模式|策略模式|Strategy|观察者|Observer|工厂|Factory|单例|Singleton|适配器|Adapter|装饰器|Decorator|命令模式|Command|桥接模式|Bridge|外观模式|Facade|代理模式|Proxy|状态模式|State|组合模式|Composite|迭代器|Iterator|访问者|Visitor|中介者|Mediator|备忘录|Memento|原型模式|Prototype|享元|Flyweight|模板方法|Template)/i,
    anchor: {
      relativeDocPath: '软件设计师复习材料/案例_专题5_设计模式与面向对象编程.md',
      anchorHeading: '# 面向对象设计模式与 Java/C++ 实现案例',
      topic: '设计模式与面向对象编程'
    }
  },
  // 4. Topic 2: Database Analysis & Design
  {
    topicId: 2,
    pattern: /(关系模式|E-R|实体联系|实体型|主键|外键|主码|外码|范式|规范化|SQL|元组演算|关系代数)/i,
    anchor: {
      relativeDocPath: '软件设计师复习材料/案例_专题2_数据库分析与设计.md',
      anchorHeading: '# 数据库设计与关系模式案例',
      topic: '数据库分析与设计'
    }
  },
  // 5. Topic 3: UML Modeling
  {
    topicId: 3,
    pattern: /(UML|用例|类图|顺序图|时序图|状态图|活动图|通信图|对象模型)/i,
    anchor: {
      relativeDocPath: '软件设计师复习材料/案例_专题3_UML建模.md',
      anchorHeading: '# UML 类图与面向对象分析案例',
      topic: '面向对象UML建模'
    }
  }
];

/**
 * Resolves material anchor for a question.
 * @param {object} question - Question object (sanitized or raw)
 * @returns {import('@ruankao/exam-contracts').MaterialAnchor}
 */
function resolveMaterialAnchor(question) {
  if (!question) {
    return {
      chapter: '软件设计师综合复习',
      topic: '核心知识体系',
      relativeDocPath: '软件设计师复习材料/软件设计师复习材料-选择题.md',
      anchorHeading: '# 软件设计师复习材料'
    };
  }

  const rawChapter = (question.chapter || '').trim();
  // Strip sub-knowledge suffix if present, e.g. "计算机组成与体系结构 · 知识点008" or "计算机组成与体系结构>CPU的组成"
  const cleanChapter = rawChapter.split(/[·>\/]/)[0].trim();

  // If question is a case study
  if (question.subject === 'case' || question.shared_stem || question.sharedStem) {
    const caseTitle = (question.case_title || question.caseTitle || (question.questions && question.questions[0] && (question.questions[0].case_title || question.questions[0].caseTitle)) || '').trim();
    const sharedStem = (question.shared_stem || question.sharedStem || '').trim();
    const groupOrder = question.group_order || (question.id && (question.id.match(/g0([1-6])/i) || [])[1] ? parseInt(question.id.match(/g0([1-6])/i)[1], 10) : undefined);
    const textToMatch = `${caseTitle} ${sharedStem} ${cleanChapter}`;

    // Priority Check 1: Topic 1 DFD
    if (cleanChapter === '系统开发基础' || cleanChapter === '结构化开发方法' || /(数据流图|DFD|0层图|顶层图|外部实体|加工逻辑|数据字典)/i.test(textToMatch)) {
      return {
        chapter: cleanChapter || '案例分析专题',
        topic: '数据流图分析与设计',
        relativeDocPath: '软件设计师复习材料/案例_专题1_数据流图DFD.md',
        anchorHeading: '# 结构化分析与设计案例：数据流图（DFD）'
      };
    }

    // Priority Check 2: Topic 4 Algorithm
    if (cleanChapter === '算法基础' || /(?:C程序|C代码|贪心策略|分治策略|动态规划|回溯|分支限界|时间复杂度|二叉排序树|矩阵链乘|0-1背包|Hamilton回路)/i.test(textToMatch) ||
        (/(算法|分治|贪心|递归)/i.test(textToMatch) && !/(Java|C\+\+|C＋＋|用例图|类图)/i.test(caseTitle))) {
      return {
        chapter: cleanChapter || '案例分析专题',
        topic: '算法设计与分析',
        relativeDocPath: '软件设计师复习材料/案例_专题4_算法设计与分析.md',
        anchorHeading: '# 算法设计与分析案例'
      };
    }

    // Priority Check 3: Topic 5 Design Patterns & Java/C++ (Group 5 & 6)
    // Must be evaluated before UML modeling so that stems with "类图" don't misclassify code questions
    const hasJavaOrCppInTitle = /(Java|C\+\+|C＋＋)/i.test(caseTitle);
    const hasJavaOrCppInText = /(?:阅读|编写)?(?:Java|C\+\+|C＋＋)(?:代码|程序|填空)/i.test(textToMatch);
    const isGroup5or6 = groupOrder === 5 || groupOrder === 6;
    const hasDesignPatternKeyword = /(设计模式|策略模式|Strategy|观察者|Observer|工厂|Factory|单例|Singleton|适配器|Adapter|装饰器|Decorator|命令模式|Command|桥接模式|Bridge|外观模式|Facade|代理模式|Proxy|状态模式|State|组合模式|Composite|迭代器|Iterator|访问者|Visitor|中介者|Mediator|备忘录|Memento|原型模式|Prototype|享元|Flyweight|模板方法|Template)/i.test(textToMatch);

    if (hasJavaOrCppInTitle || hasJavaOrCppInText || (isGroup5or6 && (hasDesignPatternKeyword || /(?:代码|程序|interface |class |void )/i.test(textToMatch))) || (hasDesignPatternKeyword && /(Java|C\+\+|C＋＋)/i.test(textToMatch))) {
      return {
        chapter: cleanChapter || '案例分析专题',
        topic: '设计模式与面向对象编程',
        relativeDocPath: '软件设计师复习材料/案例_专题5_设计模式与面向对象编程.md',
        anchorHeading: '# 面向对象设计模式与 Java/C++ 实现案例'
      };
    }

    // Priority Check 4: Topic 2 Database
    const hasStrongDbKeywords = /(关系模式|E-R|实体联系|实体型|主键|外键|主码|外码|范式|规范化|SQL|元组演算|关系代数)/i.test(textToMatch);
    const isDbTitle = /数据库/i.test(caseTitle);
    if (cleanChapter === '数据库系统' || isDbTitle || (hasStrongDbKeywords && !/(用例图|类图|状态图|序列图|活动图)/i.test(caseTitle))) {
      return {
        chapter: cleanChapter || '案例分析专题',
        topic: '数据库分析与设计',
        relativeDocPath: '软件设计师复习材料/案例_专题2_数据库分析与设计.md',
        anchorHeading: '# 数据库设计与关系模式案例'
      };
    }

    // Priority Check 5: Topic 3 UML Modeling
    if (cleanChapter === '面向对象技术' || /(UML|用例|类图|顺序图|时序图|状态图|活动图|通信图|对象模型)/i.test(textToMatch)) {
      return {
        chapter: cleanChapter || '案例分析专题',
        topic: '面向对象UML建模',
        relativeDocPath: '软件设计师复习材料/案例_专题3_UML建模.md',
        anchorHeading: '# UML 类图与面向对象分析案例'
      };
    }

    // General CASE_TOPIC_ANCHORS loop fallback
    for (const item of CASE_TOPIC_ANCHORS) {
      if (item.pattern.test(textToMatch)) {
        return {
          chapter: cleanChapter || '案例分析专题',
          topic: item.anchor.topic,
          relativeDocPath: item.anchor.relativeDocPath,
          anchorHeading: item.anchor.anchorHeading
        };
      }
    }
    return {
      chapter: cleanChapter || '案例分析',
      topic: '案例综合应用',
      relativeDocPath: '软件设计师复习材料/软件设计师复习材料-案例题.md',
      anchorHeading: '# 软件设计师案例题专题汇总'
    };
  }

  // Objective question mapping
  if (CHAPTER_ANCHOR_MAP[cleanChapter]) {
    const mapped = CHAPTER_ANCHOR_MAP[cleanChapter];
    return {
      chapter: cleanChapter,
      topic: mapped.topic,
      relativeDocPath: mapped.relativeDocPath,
      anchorHeading: mapped.anchorHeading
    };
  }

  if (CHAPTER_ANCHOR_MAP[rawChapter]) {
    const mapped = CHAPTER_ANCHOR_MAP[rawChapter];
    return {
      chapter: rawChapter,
      topic: mapped.topic,
      relativeDocPath: mapped.relativeDocPath,
      anchorHeading: mapped.anchorHeading
    };
  }

  // Fallback for unrecognized chapters
  return {
    chapter: cleanChapter || '软件设计师选择题精讲',
    topic: '综合知识点',
    relativeDocPath: '软件设计师复习材料/软件设计师复习材料-选择题.md',
    anchorHeading: '# 软件设计师复习材料'
  };
}

module.exports = {
  resolveMaterialAnchor,
  CHAPTER_ANCHOR_MAP
};
