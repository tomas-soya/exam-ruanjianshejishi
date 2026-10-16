/**
 * PersonalMaterialsView Component (AC-1, AC-2, AC-5)
 * Dual-mode Review Materials Workspace:
 * 1. 原始静态章节资料 (Static): Complete browsable 13 objective chapters + 8 case topics,
 *    directly from Markdown files without LLM processing, readable without exam records.
 * 2. 错题复习要点 (Dynamic): Exactly TWO summary documents (objective and case) based on
 *    actual wrong questions, with failure retry, versioning, and empty-state semantics.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.PersonalMaterialsView = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h2, h3, h4, p, ul, li, label, input, pre, code, details, summary } = DOM;
  const { useState, useEffect } = React;

  const DEFAULT_STATIC_CHAPTERS = [
    // 13 Objective Chapters
    { id: '01-计算机系统知识', title: '01-计算机系统知识', doc: '选择题/01-计算机系统知识.md', subject: 'objective', order: 1 },
    { id: '02-程序设计语言基础知识', title: '02-程序设计语言基础知识', doc: '选择题/02-程序设计语言基础知识.md', subject: 'objective', order: 2 },
    { id: '03-数据结构', title: '03-数据结构', doc: '选择题/03-数据结构.md', subject: 'objective', order: 3 },
    { id: '04-操作系统知识', title: '04-操作系统知识', doc: '选择题/04-操作系统知识.md', subject: 'objective', order: 4 },
    { id: '05-软件工程基础知识', title: '05-软件工程基础知识', doc: '选择题/05-软件工程基础知识.md', subject: 'objective', order: 5 },
    { id: '06-结构化开发方法', title: '06-结构化开发方法', doc: '选择题/06-结构化开发方法.md', subject: 'objective', order: 6 },
    { id: '07-面向对象技术', title: '07-面向对象技术', doc: '选择题/07-面向对象技术.md', subject: 'objective', order: 7 },
    { id: '08-算法设计与分析', title: '08-算法设计与分析', doc: '选择题/08-算法设计与分析.md', subject: 'objective', order: 8 },
    { id: '09-数据库技术基础', title: '09-数据库技术基础', doc: '选择题/09-数据库技术基础.md', subject: 'objective', order: 9 },
    { id: '10-网络与信息安全基础知识', title: '10-网络与信息安全基础知识', doc: '选择题/10-网络与信息安全基础知识.md', subject: 'objective', order: 10 },
    { id: '11-标准化和软件知识产权基础知识', title: '11-标准化和软件知识产权基础知识', doc: '选择题/11-标准化和软件知识产权基础知识.md', subject: 'objective', order: 11 },
    { id: '12-软件系统分析与设计', title: '12-软件系统分析与设计', doc: '选择题/12-软件系统分析与设计.md', subject: 'objective', order: 12 },
    { id: '13-英语', title: '13-英语', doc: '选择题/13-英语.md', subject: 'objective', order: 13 },
    // 8 Case Topics
    { id: '01-结构化分析与设计', title: '01-结构化分析与设计', doc: '案例题/01-结构化分析与设计.md', subject: 'case', order: 14 },
    { id: '02-面向对象设计模式与Java实现', title: '02-面向对象设计模式与C++和Java实现', doc: '案例题/02-面向对象设计模式与Java实现.md', subject: 'case', order: 15 },
    { id: '03-UML类图与面向对象分析', title: '03-UML类图与面向对象分析', doc: '案例题/03-UML类图与面向对象分析.md', subject: 'case', order: 16 },
    { id: '04-数据库设计与关系模式', title: '04-数据库设计与关系模式', doc: '案例题/04-数据库设计与关系模式.md', subject: 'case', order: 17 },
    { id: '05-UML用例图与活动图', title: '05-UML用例图与活动图', doc: '案例题/05-UML用例图与活动图.md', subject: 'case', order: 18 },
    { id: '06-UML序列图与关系', title: '06-UML序列图与关系', doc: '案例题/06-UML序列图与关系.md', subject: 'case', order: 19 },
    { id: '07-UML状态图与状态转换', title: '07-UML状态图与状态转换', doc: '案例题/07-UML状态图与状态转换.md', subject: 'case', order: 20 },
    { id: '08-算法设计与分析', title: '08-算法设计与分析', doc: '案例题/08-算法设计与分析.md', subject: 'case', order: 21 }
  ];

  // Split the final answer even when the prompt ends in an instruction or contains parentheses.
  function splitSelfCheck(text) {
    const value = text.trim();
    if (!/[）)]$/.test(value)) return null;
    let depth = 0;
    for (let index = value.length - 1; index >= 0; index--) {
      if (/[）)]/.test(value[index])) depth++;
      else if (/[（(]/.test(value[index])) {
        depth--;
        if (depth === 0) {
          const question = value.slice(0, index).trim();
          const answer = value.slice(index + 1, -1).trim();
          return question && answer ? [value, question, answer] : null;
        }
      }
    }
    return null;
  }

  // Safe inline markdown renderer for both static and dynamic materials
  function renderSafeMarkdown(markdown) {
    if (!markdown || typeof markdown !== 'string') return null;

    const lines = markdown.split('\n');
    const elements = [];
    let key = 0;
    const headingIds = new Map();
    const inline = text => text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(#[^)]+\))/g).map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) return code({ key: index }, part.slice(1, -1));
      if (part.startsWith('**') && part.endsWith('**')) return React.createElement('strong', { key: index }, part.slice(2, -2));
      const link = part.match(/^\[([^\]]+)\]\((#[^)]+)\)$/);
      if (link) return React.createElement('a', { key: index, href: link[2] }, link[1]);
      return part;
    });
    const cells = row => {
      const values = []; let value = '', quoted = false;
      const body = row.trim().replace(/^\|/, '').replace(/\|$/, '');
      for (let n = 0; n < body.length; n++) {
        if (body[n] === '\\' && body[n + 1] === '|') { value += '|'; n++; continue; }
        if (body[n] === '`') quoted = !quoted;
        if (body[n] === '|' && !quoted) { values.push(value.trim()); value = ''; }
        else value += body[n];
      }
      values.push(value.trim()); return values;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      const fence = trimmed.match(/^(```|~~~)([\w+.-]*)\s*$/);
      if (fence) {
        const content = [];
        const indent = line.length - line.trimStart().length;
        while (++i < lines.length && lines[i].trim() !== fence[1]) content.push(lines[i].slice(Math.min(indent, lines[i].length - lines[i].trimStart().length)));
        elements.push(pre({ key: key++, className: 'md-code-block' },
          code({ className: `language-${fence[2] || 'text'}` }, content.join('\n'))));
        continue;
      }
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const base = heading[2].replace(/[`*]/g, '').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
        const count = headingIds.get(base) || 0; headingIds.set(base, count + 1);
        elements.push(React.createElement(`h${Math.min(heading[1].length + 1, 6)}`,
          { key: key++, id: base + (count ? `-${count}` : ''), className: `md-h${heading[1].length}` }, heading[2]));
        continue;
      }
      if (trimmed.startsWith('|') && /^\|?[\s:|-]+\|?$/.test((lines[i + 1] || '').trim())) {
        const header = cells(trimmed), rows = []; i++;
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) rows.push(cells(lines[++i]));
        const h = React.createElement;
        elements.push(h('table', { key: key++, className: 'md-table' },
          h('thead', null, h('tr', null, ...header.map((value, index) => h('th', { key: index }, inline(value))))),
          h('tbody', null, ...rows.map((row, index) => h('tr', { key: index },
            ...row.map((value, n) => h('td', { key: n }, inline(value))))))));
        continue;
      }

      if (!trimmed) {
        elements.push(div({ key: key++, className: 'md-empty-line' }));
        continue;
      }

      if (trimmed.startsWith('# ')) {
        elements.push(h2({ key: key++, className: 'md-h1' }, trimmed.slice(2)));
      } else if (trimmed.startsWith('## ')) {
        elements.push(h3({ key: key++, className: 'md-h2' }, trimmed.slice(3)));
      } else if (trimmed.startsWith('### ')) {
        elements.push(h4({ key: key++, className: 'md-h3' }, trimmed.slice(4)));
      } else if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
        const isChecked = trimmed.startsWith('- [x]');
        const text = trimmed.slice(5).trim();
        elements.push(div({ key: key++, className: `md-checklist-item ${isChecked ? 'checked' : ''}` },
          span({ className: 'checklist-box' }, isChecked ? '☑' : '☐'),
          span({ className: 'checklist-text' }, text)
        ));
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const card = trimmed.slice(2).match(/^【(.+?)】待补：(.*?)；记住：(.*?)；防错：(.*?)；自测：(.*)$/);
        if (card) {
          elements.push(div({ key: key++, className: 'review-memory-card' },
            h4({}, card[1]),
            ...['待补', '记住', '防错', '自测'].map((field, index) => {
              const selfCheck = index === 3 ? splitSelfCheck(card[index + 2]) : null;
              if (selfCheck) return div({ key: field, className: 'review-card-field review-card-field-3' },
                p({}, span({ className: 'review-card-label' }, '自测：'), selfCheck[1]),
                details({ className: 'review-card-answer' }, summary({}, '思考后展开答案'), p({}, selfCheck[2])));
              return p({ key: field, className: `review-card-field review-card-field-${index}` },
                span({ className: 'review-card-label' }, `${field}：`), card[index + 2]);
            })
          ));
        } else {
          elements.push(li({ key: key++, className: 'md-list-item' }, inline(trimmed.slice(2))));
        }
      } else if (/^\d+\./.test(trimmed)) {
        elements.push(li({ key: key++, className: 'md-list-numbered' }, trimmed.replace(/^\d+\.\s*/, '')));
      } else if (trimmed.startsWith('> ')) {
        elements.push(div({ key: key++, className: 'md-blockquote' }, trimmed.slice(2)));
      } else if (trimmed === '---') {
        elements.push(div({ key: key++, className: 'md-hr' }));
      } else {
        elements.push(p({ key: key++, className: 'md-paragraph' }, inline(trimmed)));
      }
    }

    return div({ className: 'safe-markdown-body' }, elements);
  }

  function PersonalMaterialsView({
    apiClient,
    materials = [],
    isLoading = false,
    onStartChapterPractice,
    onRefresh,
    onOpenChat
  }) {
    // Mode: 'static' (原始静态章节) | 'dynamic' (错题复习要点)
    const [viewMode, setViewMode] = useState('static');

    // 1. Static materials state (AC-1)
    const [staticChapters, setStaticChapters] = useState(DEFAULT_STATIC_CHAPTERS);
    const [staticCategory, setStaticCategory] = useState('all'); // 'all' | 'objective' | 'case'
    const [selectedStaticChapter, setSelectedStaticChapter] = useState(null);
    const [staticContent, setStaticContent] = useState(null);
    const [isStaticLoading, setIsStaticLoading] = useState(false);
    const [staticError, setStaticError] = useState(null);

    // 2. Dynamic materials state (AC-1, AC-2: unified naming 错题复习要点, exactly TWO summary items)
    const [dynamicMaterials, setDynamicMaterials] = useState([
      { subject: 'objective', title: '选择题错题复习要点', status: 'empty', version: 0, markdownContent: null },
      { subject: 'case', title: '案例题错题复习要点', status: 'empty', version: 0, markdownContent: null }
    ]);
    const [selectedDynamicSubject, setSelectedDynamicSubject] = useState(null);
    const [dynamicDetail, setDynamicDetail] = useState(null);
    const [isDynamicLoading, setIsDynamicLoading] = useState(false);
    const [retryMessage, setRetryMessage] = useState(null);
    const [chapterMaterials, setChapterMaterials] = useState([]);
    const [showChapterSection, setShowChapterSection] = useState(false);
    const [retryingChapterKey, setRetryingChapterKey] = useState(null);

    // Load static catalog on mount
    useEffect(() => {
      if (!apiClient) return;
      apiClient.listStaticMaterials()
        .then(res => {
          const data = res && res.data ? res.data : res;
          if (data && Array.isArray(data.objective) && Array.isArray(data.case)) {
            const combined = [...data.objective, ...data.case];
            setStaticChapters(combined);
          }
        })
        .catch(() => {
          // Use hardcoded DEFAULT_STATIC_CHAPTERS safely
        });
    }, [apiClient]);

    // Load static content when a static chapter is selected
    useEffect(() => {
      if (!selectedStaticChapter || !apiClient) {
        setStaticContent(null);
        return;
      }

      let isMounted = true;
      setIsStaticLoading(true);
      setStaticError(null);

      apiClient.getStaticMaterial(selectedStaticChapter.doc, selectedStaticChapter.subject)
        .then(data => {
          if (isMounted) {
            const md = (data && data.markdown) ? data.markdown : (typeof data === 'string' ? data : '');
            setStaticContent(md);
          }
        })
        .catch(err => {
          if (isMounted) setStaticError(`加载讲义失败：${err.message}`);
        })
        .finally(() => {
          if (isMounted) setIsStaticLoading(false);
        });

      return () => { isMounted = false; };
    }, [selectedStaticChapter, apiClient]);

    // Load dynamic materials list and chapter list
    const loadDynamicMaterials = () => {
      if (!apiClient) return;
      apiClient.listDynamicMaterials()
        .then(res => {
          const list = Array.isArray(res) ? res : (res && res.data ? res.data : []);
          if (list.length > 0) {
            setDynamicMaterials(list);
          }
        })
        .catch(() => {});
    };

    const loadChapterMaterials = () => {
      if (!apiClient) return;
      apiClient.listPersonalMaterials()
        .then(res => {
          const list = Array.isArray(res) ? res : (res && res.data ? res.data : []);
          setChapterMaterials(list);
        })
        .catch(() => {});
    };

    useEffect(() => {
      if (viewMode === 'dynamic') {
        loadDynamicMaterials();
        loadChapterMaterials();
      }
    }, [viewMode, apiClient]);

    // Load dynamic detail when selectedDynamicSubject changes
    useEffect(() => {
      if (!selectedDynamicSubject || !apiClient) {
        setDynamicDetail(null);
        return;
      }

      let isMounted = true;
      setIsDynamicLoading(true);
      setRetryMessage(null);

      apiClient.getDynamicMaterial(selectedDynamicSubject)
        .then(data => {
          if (isMounted) setDynamicDetail(data);
        })
        .catch(err => {
          if (isMounted) setRetryMessage(`加载错题要点失败：${err.message}`);
        })
        .finally(() => {
          if (isMounted) setIsDynamicLoading(false);
        });

      return () => { isMounted = false; };
    }, [selectedDynamicSubject, apiClient]);

    // Auto-polling for active background synthesis jobs
    const isAnyJobProcessing =
      dynamicMaterials.some(d => d.status === 'processing' || d.status === 'pending') ||
      (dynamicDetail && (dynamicDetail.status === 'processing' || dynamicDetail.status === 'pending')) ||
      chapterMaterials.some(c => c.status === 'processing' || c.status === 'pending') ||
      Boolean(retryingChapterKey);

    useEffect(() => {
      if (viewMode !== 'dynamic' || !isAnyJobProcessing || !apiClient) return;

      const timer = setInterval(async () => {
        try {
          // Poll dynamic materials list
          const listRes = await apiClient.listDynamicMaterials();
          const list = Array.isArray(listRes) ? listRes : (listRes && listRes.data ? listRes.data : []);
          if (list.length > 0) {
            setDynamicMaterials(list);
          }

          // Poll chapter materials
          const chRes = await apiClient.listPersonalMaterials();
          const chList = Array.isArray(chRes) ? chRes : (chRes && chRes.data ? chRes.data : []);
          setChapterMaterials(chList);

          // If a specific chapter was being retried, check if it finished
          if (retryingChapterKey) {
            const currentCh = chList.find(c => c.chapterKey === retryingChapterKey);
            if (currentCh && currentCh.status !== 'processing' && currentCh.status !== 'pending') {
              setRetryingChapterKey(null);
            }
          }

          // Poll dynamic detail if viewing detail
          if (selectedDynamicSubject) {
            const refreshedDetail = await apiClient.getDynamicMaterial(selectedDynamicSubject);
            setDynamicDetail(refreshedDetail);
            if (refreshedDetail.status !== 'processing' && refreshedDetail.status !== 'pending') {
              if (refreshedDetail.status === 'updated') {
                setRetryMessage('已完成错题要点更新！');
                setTimeout(() => setRetryMessage(null), 3500);
              } else if (refreshedDetail.status === 'failed') {
                setRetryMessage(null);
              }
            }
          }
        } catch (pollErr) {
          console.warn('[PersonalMaterialsView] Polling error:', pollErr);
        }
      }, 2000);

      return () => clearInterval(timer);
    }, [viewMode, isAnyJobProcessing, selectedDynamicSubject, retryingChapterKey, apiClient]);

    // Handle retry dynamic material
    const handleDynamicRetry = async (subject) => {
      if (!apiClient) return;
      try {
        setRetryMessage('正在提交分批更新任务...');
        setDynamicMaterials(prev => prev.map(item => item.subject === subject ? { ...item, status: 'processing' } : item));
        if (dynamicDetail && dynamicDetail.subject === subject) {
          setDynamicDetail(prev => ({ ...prev, status: 'processing', lastError: null }));
        }
        await apiClient.retryDynamicMaterial(subject);
        setRetryMessage('已触发分批更新，后台正在逐章提炼考点中...');
        loadDynamicMaterials();
        loadChapterMaterials();
      } catch (e) {
        setRetryMessage(`更新失败：${e.message}`);
      }
    };

    // Handle single chapter retry
    const handleChapterRetry = async (chapterKey) => {
      if (!apiClient || !chapterKey) return;
      try {
        setRetryingChapterKey(chapterKey);
        setRetryMessage(`正在分批更新章节【${chapterKey}】...`);
        setChapterMaterials(prev => prev.map(ch => ch.chapterKey === chapterKey ? { ...ch, status: 'processing', lastError: null } : ch));
        await apiClient.retryPersonalMaterial(chapterKey);
        setRetryMessage(`已触发本章更新，后台正在提炼考点...`);
        loadChapterMaterials();
      } catch (e) {
        setRetryMessage(`章节更新失败：${e.message}`);
        setRetryingChapterKey(null);
      }
    };

    // Filter static chapters
    const filteredStaticChapters = staticChapters.filter(ch => {
      if (staticCategory === 'objective') return ch.subject === 'objective';
      if (staticCategory === 'case') return ch.subject === 'case';
      return true;
    });

    const objectiveCount = staticChapters.filter(m => m.subject === 'objective').length || 13;
    const caseCount = staticChapters.filter(m => m.subject === 'case').length || 8;

    // View A: Detailed Static Chapter Reader Panel (AC-1)
    if (viewMode === 'static' && selectedStaticChapter) {
      return div({ className: 'materials-detail-container static-reader-container' },
        div({ className: 'materials-detail-topbar' },
          button({
            className: 'btn-back-to-catalog btn-back-static',
            onClick: () => { setSelectedStaticChapter(null); setStaticContent(null); }
          }, '← 返回章节讲义目录'),

          div({ className: 'materials-topbar-meta' },
            span({ className: `badge-subject subject-${selectedStaticChapter.subject}` },
              selectedStaticChapter.subject === 'case' ? '案例题专题' : '选择题章节'
            ),
            span({ className: 'badge-doc-path' }, selectedStaticChapter.doc || selectedStaticChapter.id)
          )
        ),

        staticError && div({ className: 'alert-box warning' }, p(null, staticError)),

        isStaticLoading ? div({ className: 'loading-box' }, p(null, '正在加载讲义原文...')) :
        div({ className: 'materials-reader-panel' },
          div({ className: 'reader-header-card' },
            div({ className: 'reader-title-row' },
              h2({ className: 'reader-chapter-title' }, selectedStaticChapter.title || selectedStaticChapter.id),
              div({ className: 'reader-actions-row' },
                onOpenChat && button({
                  type: 'button',
                  className: 'btn-secondary-action btn-ask-material-chat',
                  onClick: () => onOpenChat({
                    type: 'material',
                    targetId: selectedStaticChapter.id,
                    title: `考点讲义：${selectedStaticChapter.title}`,
                    chapter: selectedStaticChapter.title
                  }),
                  title: '针对本讲义考点向 AI 助教提问'
                }, '🤖 讲义考点答疑')
              )
            ),
            p({ className: 'static-source-hint' }, '按考点整理的基础复习资料，开始刷题前也可阅读。')
          ),

          div({ className: 'markdown-content-box' },
            renderSafeMarkdown(staticContent)
          )
        )
      );
    }

    // View B: Detailed Dynamic Material Reader Panel (AC-1, AC-2: 错题复习要点)
    if (viewMode === 'dynamic' && selectedDynamicSubject) {
      const item = dynamicDetail || dynamicMaterials.find(d => d.subject === selectedDynamicSubject) || {};
      const isFailed = item.status === 'failed';
      const isUpdated = item.status === 'updated';
      const isEmpty = item.status === 'empty' || !item.markdownContent;

      return div({ className: 'materials-detail-container dynamic-reader-container' },
        div({ className: 'materials-detail-topbar' },
          button({
            className: 'btn-back-to-catalog btn-back-dynamic',
            onClick: () => { setSelectedDynamicSubject(null); setDynamicDetail(null); }
          }, '← 返回错题复习要点'),

          div({ className: 'materials-topbar-meta' },
            span({ className: `badge-subject subject-${item.subject}` },
              item.subject === 'case' ? '案例题汇总' : '选择题汇总'
            ),
            isUpdated && span({ className: 'badge-version' }, `v${item.version || 1}`),
            item.lastUpdatedAt && span({ className: 'text-last-updated' },
              `更新于：${new Date(item.lastUpdatedAt).toLocaleString()}`
            )
          )
        ),

        retryMessage && div({ className: 'alert-box info' }, p(null, retryMessage)),

        (item.status === 'processing' || item.status === 'pending') && div({ className: 'alert-box info' },
          p({ className: 'alert-title' }, '⏳ 大模型正在分批提炼考点中...'),
          p({ className: 'alert-desc' }, '系统采用小批次防截断提炼，正逐章处理错题。页面将自动实时更新，无需手动刷新。')
        ),

        isFailed && div({ className: 'alert-box warning' },
          p({ className: 'alert-title' }, '⚠️ 大模型生成遇到单次长度上限或网络配额异常，已安全保留上一版本要点。'),
          p({ className: 'alert-desc' }, item.lastError ? `错误原因：${item.lastError}` : '建议点击下方按钮分批重试'),
          div({ style: { display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' } },
            button({
              className: 'btn-retry-action',
              onClick: () => handleDynamicRetry(item.subject)
            }, '🔄 分批全部重试'),
            button({
              type: 'button',
              className: 'btn-secondary-action',
              onClick: () => {
                setShowChapterSection(true);
                loadChapterMaterials();
              }
            }, '📑 展开按章节单章更新/重试')
          )
        ),

        isDynamicLoading ? div({ className: 'loading-box' }, p(null, '正在加载题型复习要点...')) :
        isEmpty ? div({ className: 'empty-box dynamic-empty-box' },
          h3(null, `【${item.title || (item.subject === 'case' ? '案例题' : '选择题')}】尚无错题实测数据`),
          p(null, '系统仅在您交卷并产生真实错题或失分时，由大模型针对性提炼简短复习要点与解题自查动作，坚决不复述教材泛论。请前往【历年真题】或【章节特训】开始练习！'),
          div({ className: 'empty-box-actions' },
            onOpenChat && button({
              type: 'button',
              className: 'btn-secondary-action btn-ask-material-chat',
              onClick: () => onOpenChat({
                type: 'material',
                targetId: item.subject,
                title: item.title,
                chapter: item.title
              }),
              title: '向 AI 助教提问'
            }, '🤖 AI 助教答疑')
          )
        ) :
        div({ className: 'materials-reader-panel' },
          div({ className: 'reader-header-card' },
            div({ className: 'reader-title-row' },
              h2({ className: 'reader-chapter-title' }, item.title),
              div({ className: 'reader-actions-row' },
                onOpenChat && button({
                  type: 'button',
                  className: 'btn-secondary-action btn-ask-material-chat',
                  onClick: () => onOpenChat({
                    type: 'material',
                    targetId: item.subject,
                    title: item.title,
                    chapter: item.title
                  }),
                  title: '向 AI 助教提问'
                }, '🤖 考点要点答疑'),
                button({
                  type: 'button',
                  className: 'btn-secondary-action btn-toggle-chapters',
                  onClick: () => {
                    setShowChapterSection(!showChapterSection);
                    if (!showChapterSection) loadChapterMaterials();
                  }
                }, showChapterSection ? '▴ 收起各章节' : '📑 按章节分批状态与单章更新'),
                button({
                  className: 'btn-secondary-action btn-retry-sync',
                  onClick: () => handleDynamicRetry(item.subject)
                }, '🔄 分批全部更新')
              )
            ),

            div({ className: 'reader-stats-grid' },
              div({ className: 'stat-badge' },
                span({ className: 'stat-num' }, String(item.summary?.weakPointsCount || 0)),
                span({ className: 'stat-label' }, '复习要点')
              ),
              div({ className: 'stat-badge' },
                span({ className: 'stat-num' }, String(item.summary?.tipsCount || 0)),
                span({ className: 'stat-label' }, '解题Tips')
              ),
              div({ className: 'stat-badge' },
                span({ className: 'stat-num' }, String(item.summary?.checklistsCount || 0)),
                span({ className: 'stat-label' }, '自查项')
              ),
              div({ className: 'stat-badge' },
                span({ className: 'stat-num' }, String(item.summary?.chaptersWithDataCount || 0)),
                span({ className: 'stat-label' }, '涉及章节')
              )
            ),

            showChapterSection && div({ className: 'chapter-batch-manager-card', style: { marginTop: '1rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid var(--border)' } },
              div({ style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' } },
                h4({ style: { margin: 0, fontSize: '0.95rem', fontWeight: 600 } }, `分章节考点提炼状态（${item.subject === 'case' ? '案例题 8 专题' : '选择题 13 章节'}）`),
                span({ style: { fontSize: '0.8rem', color: 'var(--text-muted)' } }, '系统采用小批次防截断提炼，支持单章独立更新与重试')
              ),
              div({ className: 'chapter-batch-list', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.5rem' } },
                (chapterMaterials.length > 0 ? chapterMaterials : staticChapters)
                  .filter(ch => (ch.subject || (ch.id && ch.id.includes('案例') ? 'case' : 'objective')) === item.subject)
                  .map(ch => {
                    const key = ch.chapterKey || ch.id;
                    const name = ch.chapterName || ch.title || key;
                    const chDetail = chapterMaterials.find(c => c.chapterKey === key) || ch;
                    const status = chDetail.status || 'empty';
                    const isChRetrying = retryingChapterKey === key;
                    const isChFailed = status === 'failed';
                    const isChProcessing = status === 'processing' || status === 'pending';
                    const pointsCount = chDetail.summary?.weakPointsCount || 0;

                    let statusText = '尚无错题';
                    let statusColor = '#94a3b8';
                    if (status === 'updated') { statusText = `已更新 (${pointsCount}要点)`; statusColor = '#16a34a'; }
                    else if (isChProcessing) { statusText = '分批提炼中...'; statusColor = '#2563eb'; }
                    else if (isChFailed) { statusText = '生成受阻(已保底)'; statusColor = '#dc2626'; }

                    return div({
                      key,
                      style: {
                        padding: '0.6rem 0.75rem',
                        backgroundColor: '#fff',
                        borderRadius: '0.35rem',
                        border: isChFailed ? '1px solid #fca5a5' : '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }
                    },
                      div({ style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '0.5rem' } },
                        div({ style: { fontSize: '0.85rem', fontWeight: 500 } }, name),
                        div({ style: { fontSize: '0.75rem', color: statusColor } }, statusText)
                      ),
                      button({
                        type: 'button',
                        disabled: isChRetrying,
                        style: {
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          border: '1px solid #cbd5e1',
                          backgroundColor: isChFailed ? '#fee2e2' : '#f1f5f9',
                          color: isChFailed ? '#991b1b' : '#334155',
                          cursor: isChRetrying ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap'
                        },
                        onClick: () => handleChapterRetry(key)
                      }, isChRetrying ? '提炼中...' : (isChFailed ? '重试本章' : '更新本章'))
                    );
                  })
              )
            )
          ),

          div({ className: 'markdown-content-box' },
            renderSafeMarkdown(item.markdownContent)
          )
        )
      );
    }

    // Main Catalog Workspace: Segmented switcher between Static and Dynamic modes
    return div({ className: 'personal-materials-container materials-workspace-container' },
      // Header Bar
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '软件设计师复习资料库'),
          span({ className: 'view-subtitle' },
            viewMode === 'static'
              ? '包含13个完整选择题章节与8个案例专题原文讲义，未经大模型处理，随时自由研读。'
              : '从实际失分定位待补知识，记住判定规则，用防错动作和迁移自测巩固同类题。'
          )
        ),
        div({ className: 'view-actions' },
          button({
            className: 'btn-secondary-action',
            onClick: () => {
              if (viewMode === 'dynamic') loadDynamicMaterials();
              if (onRefresh) onRefresh();
            }
          }, '🔄 刷新资料')
        )
      ),

      // Top-level Mode Switcher Tabs (AC-1: 错题复习要点)
      div({ className: 'materials-mode-tabs-bar' },
        button({
          type: 'button',
          className: `btn-mode-tab ${viewMode === 'static' ? 'active' : ''}`,
          onClick: () => setViewMode('static')
        }, '📖 原始静态章节资料 (21)'),
        button({
          type: 'button',
          className: `btn-mode-tab ${viewMode === 'dynamic' ? 'active' : ''}`,
          onClick: () => setViewMode('dynamic')
        }, '⚡ 错题复习要点 (2)')
      ),

      // =====================================================================
      // 1. Static Catalog (AC-1: 13 Objective + 8 Case Chapters)
      // =====================================================================
      viewMode === 'static' && div({ className: 'static-materials-section' },
        // Category Filters
        div({ className: 'filter-tabs-bar' },
          button({
            className: `filter-btn ${staticCategory === 'all' ? 'active' : ''}`,
            onClick: () => setStaticCategory('all')
          }, `全部章节 (${staticChapters.length})`),
          button({
            className: `filter-btn ${staticCategory === 'objective' ? 'active' : ''}`,
            onClick: () => setStaticCategory('objective')
          }, `选择题章节 (${objectiveCount})`),
          button({
            className: `filter-btn ${staticCategory === 'case' ? 'active' : ''}`,
            onClick: () => setStaticCategory('case')
          }, `案例题专题 (${caseCount})`)
        ),

        div({ className: 'materials-grid static-chapters-grid' },
          filteredStaticChapters.map(ch => div({
            key: ch.id + '_' + ch.subject,
            className: `chapter-material-card static-chapter-card subject-${ch.subject}`,
            onClick: () => setSelectedStaticChapter(ch)
          },
            div({ className: 'card-header-line' },
              span({ className: `badge-tag subject-${ch.subject}` },
                ch.subject === 'case' ? '案例题' : '选择题'
              ),
              span({ className: 'status-pill status-static' }, '📖 基础复习资料')
            ),
            h3({ className: 'card-chapter-name' }, ch.title || ch.id),
            div({ className: 'card-body-metrics' },
              p({ className: 'text-static-hint' }, `讲义文件：${ch.doc || ch.id}`)
            ),
            div({ className: 'card-footer-line' },
              span({ className: 'text-footer-hint' }, '点击阅读讲义原文 →'),
              span({ className: 'arrow-icon' }, '→')
            )
          ))
        )
      ),

      // =====================================================================
      // 2. Dynamic Catalog (AC-1, AC-2: Exactly TWO Summary Cards - Objective & Case)
      // =====================================================================
      viewMode === 'dynamic' && div({ className: 'dynamic-materials-section' },
        div({ className: 'dynamic-notice-bar' },
          p(null, '错题复习要点仅按选择题与案例题两类题型汇总生成，严格基于您在做题实测中的真实错题与失分表现。')
        ),

        div({ className: 'dynamic-summary-grid' },
          dynamicMaterials.map(item => {
            const isEmpty = item.status === 'empty' || !item.markdownContent;
            const isPending = item.status === 'pending' || item.status === 'processing';
            const isFailed = item.status === 'failed';
            const isUpdated = item.status === 'updated' && !isEmpty;

            return div({
              key: item.subject,
              className: `chapter-material-card dynamic-summary-card card-status-${item.status}`,
              onClick: () => setSelectedDynamicSubject(item.subject)
            },
              div({ className: 'card-header-line' },
                span({ className: `badge-tag subject-${item.subject}` },
                  item.subject === 'case' ? '案例题汇总' : '选择题汇总'
                ),
                span({ className: `status-pill status-${item.status}` },
                  isEmpty ? '⚪ 尚无错题实测' :
                  isPending ? '⏳ 正在提炼要点' :
                  isFailed ? '⚠️ 更新失败(可重试)' :
                  `✅ 已建立 v${item.version || 1}`
                )
              ),

              h3({ className: 'card-chapter-name' }, item.title),

              div({ className: 'card-body-metrics' },
                isEmpty ? p({ className: 'text-empty-hint' }, '尚无错题实测数据，交卷后系统将自动基于真实错题动态生成专属复习要点。') :
                div({ className: 'metrics-badges-row' },
                  span({ className: 'metric-pill' }, `📌 ${item.summary?.weakPointsCount || 0} 个要点`),
                  span({ className: 'metric-pill' }, `💡 ${item.summary?.tipsCount || 0} 个Tips`),
                  span({ className: 'metric-pill' }, `📋 ${item.summary?.checklistsCount || 0} 个自查项`),
                  span({ className: 'metric-pill' }, `📚 ${item.summary?.chaptersWithDataCount || 0} 个章节已归并`)
                )
              ),

              div({ className: 'card-footer-line' },
                span({ className: 'text-footer-hint' },
                  isEmpty ? '点击查看生成说明 →' : '点击查阅错题复习要点 →'
                ),
                span({ className: 'arrow-icon' }, '→')
              )
            );
          })
        )
      )
    );
  }

  return PersonalMaterialsView;
});
