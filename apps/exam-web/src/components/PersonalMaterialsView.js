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

  const { div, span, button, h2, h3, h4, p, ul, li, label, input, pre, code } = DOM;
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
    { id: '02-面向对象设计模式与Java实现', title: '02-面向对象设计模式与Java实现', doc: '案例题/02-面向对象设计模式与Java实现.md', subject: 'case', order: 15 },
    { id: '03-UML类图与面向对象分析', title: '03-UML类图与面向对象分析', doc: '案例题/03-UML类图与面向对象分析.md', subject: 'case', order: 16 },
    { id: '04-数据库设计与关系模式', title: '04-数据库设计与关系模式', doc: '案例题/04-数据库设计与关系模式.md', subject: 'case', order: 17 },
    { id: '05-UML用例图与活动图', title: '05-UML用例图与活动图', doc: '案例题/05-UML用例图与活动图.md', subject: 'case', order: 18 },
    { id: '06-UML序列图与关系', title: '06-UML序列图与关系', doc: '案例题/06-UML序列图与关系.md', subject: 'case', order: 19 },
    { id: '07-UML状态图与状态转换', title: '07-UML状态图与状态转换', doc: '案例题/07-UML状态图与状态转换.md', subject: 'case', order: 20 },
    { id: '08-算法设计与分析', title: '08-算法设计与分析', doc: '案例题/08-算法设计与分析.md', subject: 'case', order: 21 }
  ];

  // Safe inline markdown renderer for both static and dynamic materials
  function renderSafeMarkdown(markdown) {
    if (!markdown || typeof markdown !== 'string') return null;

    const lines = markdown.split('\n');
    const elements = [];
    let key = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

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
        elements.push(li({ key: key++, className: 'md-list-item' }, trimmed.slice(2)));
      } else if (/^\d+\./.test(trimmed)) {
        elements.push(li({ key: key++, className: 'md-list-numbered' }, trimmed.replace(/^\d+\.\s*/, '')));
      } else if (trimmed.startsWith('> ')) {
        elements.push(div({ key: key++, className: 'md-blockquote' }, trimmed.slice(2)));
      } else if (trimmed === '---') {
        elements.push(div({ key: key++, className: 'md-hr' }));
      } else {
        elements.push(p({ key: key++, className: 'md-paragraph' }, trimmed));
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

    // Load dynamic materials list
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

    useEffect(() => {
      if (viewMode === 'dynamic') {
        loadDynamicMaterials();
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

    // Handle retry dynamic material
    const handleDynamicRetry = async (subject) => {
      if (!apiClient) return;
      try {
        setRetryMessage('正在提交后台重试任务...');
        await apiClient.retryDynamicMaterial(subject);
        setRetryMessage('已触发重试，后台正在处理中');
        loadDynamicMaterials();
        setTimeout(async () => {
          try {
            const refreshed = await apiClient.getDynamicMaterial(subject);
            setDynamicDetail(refreshed);
          } catch {}
        }, 1500);
      } catch (e) {
        setRetryMessage(`重试失败：${e.message}`);
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

        isFailed && div({ className: 'alert-box warning' },
          p({ className: 'alert-title' }, '⚠️ 大模型维护遇到网络或配额异常，已保留上一版本要点。'),
          p({ className: 'alert-desc' }, item.lastError ? `错误原因：${item.lastError}` : '建议点击右侧按钮重新触发'),
          button({
            className: 'btn-retry-action',
            onClick: () => handleDynamicRetry(item.subject)
          }, '🔄 重新触发生成')
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
                  className: 'btn-secondary-action btn-retry-sync',
                  onClick: () => handleDynamicRetry(item.subject)
                }, '🔄 重新触发生成')
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
              : '按选择题与案例题两大题型汇总真实错题复习要点，去重提炼核心考点与解题自查动作。'
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
