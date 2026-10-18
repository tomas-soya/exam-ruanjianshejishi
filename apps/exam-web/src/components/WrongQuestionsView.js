/**
 * WrongQuestionsView Component
 * Manages personal wrong question notebook.
 * Supports filtering by question type (objective vs case) and paper.
 * Groups wrong questions by paper by default.
 * Allows directly starting practice of all wrong questions of a paper on click without question count limit.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.WrongQuestionsView = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h2, h3, p, select, option } = DOM;
  const { useState, useMemo } = React;

  function getSeasonOrderScore(season) {
    if (season === '11' || season === '下半年') return 2;
    if (season === '05' || season === '上半年') return 1;
    return 0;
  }

  function comparePaperGroups(a, b) {
    const numA = Number(a.paperInfo.year);
    const numB = Number(b.paperInfo.year);
    const isNumA = Number.isFinite(numA) && a.paperInfo.year !== 'unknown' && a.paperInfo.year !== '0';
    const isNumB = Number.isFinite(numB) && b.paperInfo.year !== 'unknown' && b.paperInfo.year !== '0';

    if (isNumA && isNumB) {
      if (numB !== numA) return numB - numA;
    } else if (isNumA && !isNumB) {
      return -1;
    } else if (!isNumA && isNumB) {
      return 1;
    }

    const scoreA = getSeasonOrderScore(a.paperInfo.season);
    const scoreB = getSeasonOrderScore(b.paperInfo.season);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return String(a.paperId || '').localeCompare(String(b.paperId || ''));
  }

  function formatPaperSeason(paper) {
    if (!paper) return '';
    const yr = (paper.year && paper.year !== 'unknown') ? `${paper.year}年` : '';
    if (paper.season === '05' || paper.season === '上半年') return `${yr}上半年`;
    if (paper.season === '11' || paper.season === '下半年') return `${yr}下半年`;
    return yr;
  }

  function resolvePaperDisplay(paperId, papersMap, sampleQuestion) {
    const paper = papersMap.get(paperId);
    if (paper) {
      const isCase = paper.subject === 'case' || (sampleQuestion && sampleQuestion.questionType === 'case');
      return {
        id: paper.id,
        title: paper.title || paper.id,
        subject: paper.subject || (isCase ? 'case' : 'objective'),
        isCase,
        seasonText: formatPaperSeason(paper),
        year: String(paper.year || 'unknown'),
        season: String(paper.season || '00')
      };
    }

    // Fallback: parse paperId (e.g., sd-2023-11-objective-xxx or sd-2023-11-case-xxx)
    const match = String(paperId || '').match(/^sd-(\d{4})-(\d{2})-(objective|case)/);
    if (match) {
      const yr = match[1];
      const seasonCode = match[2];
      const subj = match[3];
      const seasonText = seasonCode === '05' ? '上半年' : (seasonCode === '11' ? '下半年' : '');
      const isCase = subj === 'case';
      const subjText = isCase ? '案例分析' : '综合知识';
      return {
        id: paperId,
        title: `${yr}年${seasonText}软件设计师${subjText}真题`,
        subject: subj,
        isCase,
        seasonText: `${yr}年${seasonText}`,
        year: yr,
        season: seasonCode
      };
    }

    const isCase = sampleQuestion && sampleQuestion.questionType === 'case';
    return {
      id: paperId || 'unknown',
      title: paperId && paperId !== 'unknown' ? paperId : '历年真题（未指定试卷）',
      subject: isCase ? 'case' : 'objective',
      isCase,
      seasonText: '历年真题',
      year: '0',
      season: '00'
    };
  }

  function WrongQuestionsView({
    wrongQuestions = [],
    chapters = [],
    papers = [],
    onStartWrongPractice,
    onToggleMastered
  }) {
    const [filterQuestionType, setFilterQuestionType] = useState('all'); // 'all' | 'objective' | 'case'
    const [filterPaperId, setFilterPaperId] = useState(''); // '' for all papers
    const [selectedChapter, setSelectedChapter] = useState('');
    const [filterMastered, setFilterMastered] = useState('all'); // 'all' | 'unmastered' | 'mastered'
    const [expandedPapers, setExpandedPapers] = useState({}); // { [paperId]: boolean }

    // Map for fast paper lookup
    const papersMap = useMemo(() => {
      const map = new Map();
      if (Array.isArray(papers)) {
        for (const p of papers) {
          if (p && p.id) {
            map.set(p.id, p);
          }
        }
      }
      return map;
    }, [papers]);

    // Summary counts by question type across all wrong questions
    const objectiveCount = wrongQuestions.filter(q => q.questionType === 'objective' || (!q.questionType && (!q.paperId || !q.paperId.includes('case')))).length;
    const caseCount = wrongQuestions.filter(q => q.questionType === 'case' || (!q.questionType && q.paperId && q.paperId.includes('case'))).length;
    const totalUnmasteredCount = wrongQuestions.filter(q => !q.mastered).length;
    const totalMasteredCount = wrongQuestions.length - totalUnmasteredCount;

    // Filter available papers for the dropdown based on wrong questions
    const availablePapersForFilter = useMemo(() => {
      const map = new Map();
      for (const q of wrongQuestions) {
        const pid = q.paperId || 'unknown';
        if (!map.has(pid)) {
          const display = resolvePaperDisplay(pid, papersMap, q);
          map.set(pid, { id: pid, title: display.title, count: 0, year: display.year, season: display.season });
        }
        map.get(pid).count++;
      }
      return Array.from(map.values()).sort((a, b) => {
        const numA = Number(a.year);
        const numB = Number(b.year);
        if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
          return numB - numA;
        }
        return b.season.localeCompare(a.season);
      });
    }, [wrongQuestions, papersMap]);

    // Apply active filters
    const filtered = useMemo(() => {
      return wrongQuestions.filter(item => {
        // 1. Question Type Filter (案例题 / 选择题)
        if (filterQuestionType === 'objective') {
          const isObj = item.questionType === 'objective' || (!item.questionType && (!item.paperId || !item.paperId.includes('case')));
          if (!isObj) return false;
        } else if (filterQuestionType === 'case') {
          const isCase = item.questionType === 'case' || (!item.questionType && item.paperId && item.paperId.includes('case'));
          if (!isCase) return false;
        }

        // 2. Paper Filter (试卷)
        if (filterPaperId && (item.paperId || 'unknown') !== filterPaperId) {
          return false;
        }

        // 3. Chapter Filter
        if (selectedChapter && item.chapter !== selectedChapter) {
          return false;
        }

        // 4. Mastery State Filter
        if (filterMastered === 'unmastered' && item.mastered) return false;
        if (filterMastered === 'mastered' && !item.mastered) return false;

        return true;
      });
    }, [wrongQuestions, filterQuestionType, filterPaperId, selectedChapter, filterMastered]);

    // Group filtered wrong questions by paper
    const paperGroups = useMemo(() => {
      const groupMap = new Map();
      for (const q of filtered) {
        const pid = q.paperId || 'unknown';
        if (!groupMap.has(pid)) {
          const info = resolvePaperDisplay(pid, papersMap, q);
          groupMap.set(pid, {
            paperId: pid,
            paperInfo: info,
            isCase: info.isCase,
            questions: [],
            unmasteredCount: 0,
            masteredCount: 0
          });
        }
        const grp = groupMap.get(pid);
        grp.questions.push(q);
        if (q.mastered) {
          grp.masteredCount++;
        } else {
          grp.unmasteredCount++;
        }
      }

      const groups = Array.from(groupMap.values());
      groups.sort(comparePaperGroups);
      return groups;
    }, [filtered, papersMap]);

    const togglePaperExpanded = (paperId) => {
      setExpandedPapers(prev => ({
        ...prev,
        [paperId]: !prev[paperId]
      }));
    };

    const handleStartPractice = (questionIds, paperInfo) => {
      if (typeof onStartWrongPractice === 'function') {
        onStartWrongPractice(questionIds, paperInfo);
      }
    };

    const filteredUnmasteredCount = filtered.filter(q => !q.mastered).length;

    return div({ className: 'wrong-questions-container' },
      // Header Bar
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '我的错题本'),
          span({ className: 'view-subtitle' },
            `共累计 ${wrongQuestions.length} 道错题，分布在 ${availablePapersForFilter.length} 套试卷中（待强化巩固 ${totalUnmasteredCount} 道）`
          )
        ),
        div({ className: 'view-actions' },
          filtered.length > 0 && button({
            className: 'btn-primary-action btn-start-all-wrong',
            onClick: () => handleStartPractice(
              filtered.map(q => q.questionId),
              filterPaperId ? papersMap.get(filterPaperId) : null
            )
          }, `🔥 刷当前筛选错题 (${filtered.length}题)`)
        )
      ),

      // Filter Toolbar
      div({ className: 'wrong-filter-toolbar' },
        // 1. Question Type Filter (案例题 / 选择题)
        div({ className: 'filter-item filter-type-group' },
          span({ className: 'filter-label' }, '题型筛选：'),
          button({
            className: `btn-filter-tag ${filterQuestionType === 'all' ? 'active' : ''}`,
            onClick: () => setFilterQuestionType('all')
          }, `全部 (${wrongQuestions.length})`),
          button({
            className: `btn-filter-tag ${filterQuestionType === 'objective' ? 'active' : ''}`,
            onClick: () => setFilterQuestionType('objective')
          }, `选择题 (${objectiveCount})`),
          button({
            className: `btn-filter-tag ${filterQuestionType === 'case' ? 'active' : ''}`,
            onClick: () => setFilterQuestionType('case')
          }, `案例题 (${caseCount})`)
        ),

        // 2. Paper Filter (试卷)
        div({ className: 'filter-item filter-paper-group' },
          span({ className: 'filter-label' }, '试卷筛选：'),
          select({
            className: 'filter-select',
            value: filterPaperId,
            onChange: (e) => setFilterPaperId(e.target.value)
          },
            option({ value: '' }, `全部试卷 (${availablePapersForFilter.length}套)`),
            availablePapersForFilter.map(p => option({
              key: p.id,
              value: p.id
            }, `${p.title} (${p.count}题)`))
          )
        ),

        // 3. Mastery State Filter
        div({ className: 'filter-item' },
          span({ className: 'filter-label' }, '掌握状态：'),
          button({
            className: `btn-filter-tag ${filterMastered === 'all' ? 'active' : ''}`,
            onClick: () => setFilterMastered('all')
          }, '全部'),
          button({
            className: `btn-filter-tag danger ${filterMastered === 'unmastered' ? 'active' : ''}`,
            onClick: () => setFilterMastered('unmastered')
          }, `待巩固 (${filteredUnmasteredCount})`),
          button({
            className: `btn-filter-tag success ${filterMastered === 'mastered' ? 'active' : ''}`,
            onClick: () => setFilterMastered('mastered')
          }, `已掌握 (${filtered.length - filteredUnmasteredCount})`)
        ),

        // 4. Chapter Filter (if available)
        chapters.length > 0 && div({ className: 'filter-item' },
          span({ className: 'filter-label' }, '章节筛选：'),
          select({
            className: 'filter-select',
            value: selectedChapter,
            onChange: (e) => setSelectedChapter(e.target.value)
          },
            option({ value: '' }, '全部章节'),
            chapters.map(ch => option({
              key: typeof ch === 'string' ? ch : ch.chapter,
              value: typeof ch === 'string' ? ch : ch.chapter
            }, typeof ch === 'string' ? ch : ch.chapter))
          )
        )
      ),

      // Paper-Grouped Wrong Questions List
      filtered.length === 0 ? div({ className: 'empty-box' },
        p(null, '暂无符合筛选条件的错题记录。保持良好刷题习惯！')
      ) :
      div({ className: 'wrong-paper-groups-list' },
        paperGroups.map(group => {
          // If only 1 paper is filtered, default to expanded
          const isExplicitSingle = Boolean(filterPaperId);
          const isExpanded = expandedPapers[group.paperId] ?? isExplicitSingle;

          return div({
            key: group.paperId,
            className: `wrong-paper-group-card ${group.isCase ? 'case-paper-group' : 'obj-paper-group'}`
          },
            // Clickable Paper Card Header: clicking the card header directly starts practicing all wrong questions of this paper
            div({
              className: 'wrong-paper-group-header',
              onClick: () => handleStartPractice(group.questions.map(q => q.questionId), group.paperInfo)
            },
              div({ className: 'paper-group-info' },
                div({ className: 'paper-group-tags' },
                  span({ className: `badge-paper-type ${group.isCase ? 'type-case' : 'type-obj'}` },
                    group.isCase ? '下午·案例题' : '上午·选择题'
                  ),
                  span({ className: 'paper-stat-badge' }, `共 ${group.questions.length} 道错题`),
                  span({ className: 'paper-stat-badge unmastered' }, `待巩固 ${group.unmasteredCount} 道`),
                  group.masteredCount > 0 && span({ className: 'paper-stat-badge mastered' }, `已掌握 ${group.masteredCount} 道`)
                ),
                h3({ className: 'paper-group-title' }, group.paperInfo.title)
              ),

              div({ className: 'paper-group-actions', onClick: (e) => e.stopPropagation() },
                button({
                  className: 'btn-paper-quick-practice btn-primary',
                  title: '点击直接开始刷该试卷的所有错题',
                  onClick: () => handleStartPractice(group.questions.map(q => q.questionId), group.paperInfo)
                }, `⚡ 开始刷该卷所有错题 (${group.questions.length}题)`),

                button({
                  className: 'btn-toggle-paper-details',
                  onClick: () => togglePaperExpanded(group.paperId)
                }, isExpanded ? '收起题目 ▲' : '查看题目 ▼')
              )
            ),

            // Collapsible Question Cards Grid for this paper
            isExpanded && div({ className: 'wrong-items-grid paper-questions-details' },
              group.questions.map(item =>
                div({ key: item.id || item.questionId, className: `wrong-item-card ${item.mastered ? 'mastered' : ''}` },
                  div({ className: 'wrong-card-header' },
                    span({ className: 'chapter-badge' }, item.chapter || '未分类'),
                    span({ className: `badge-status ${item.mastered ? 'status-green' : 'status-red'}` },
                      item.mastered ? '已掌握' : `错误 ${item.wrongCount || 1} 次`
                    )
                  ),
                  div({ className: 'wrong-card-body' },
                    h3({ className: 'wrong-qid' }, item.questionId),
                    p({ className: 'wrong-time-info' },
                      `初次做错：${item.firstWrongAt ? new Date(item.firstWrongAt).toLocaleDateString() : '—'} | 最近做错：${item.lastWrongAt ? new Date(item.lastWrongAt).toLocaleDateString() : '—'}`
                    )
                  ),
                  div({ className: 'wrong-card-footer' },
                    button({
                      className: `btn-toggle-mastery ${item.mastered ? 'btn-unmaster' : 'btn-master'}`,
                      onClick: (e) => {
                        e.stopPropagation();
                        if (typeof onToggleMastered === 'function') {
                          onToggleMastered(item.id || item.questionId, !item.mastered);
                        }
                      }
                    }, item.mastered ? '移回待强化' : '✓ 标记为已掌握')
                  )
                )
              )
            )
          );
        })
      )
    );
  }

  return WrongQuestionsView;
});
