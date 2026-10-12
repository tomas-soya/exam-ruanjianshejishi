/**
 * PaperList Component
 * Displays available exam papers with subject/year filtering,
 * total question counts, and start simulation triggers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('react'),
      require('../utils/dom'),
      require('./FilterBar')
    );
  } else {
    root.PaperList = factory(
      root.React,
      root.DOM,
      root.FilterBar
    );
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM, FilterBar) {
  'use strict';

  const { div, span, button, h2, h3, p } = DOM;
  const { useState } = React;

  function getSeasonOrderScore(season) {
    if (season === '11' || season === '下半年') return 2;
    if (season === '05' || season === '上半年') return 1;
    return 0; // '00', 'unknown'
  }

  function comparePapers(a, b) {
    const numA = Number(a.year);
    const numB = Number(b.year);
    const isNumA = Number.isFinite(numA) && a.year !== 'unknown';
    const isNumB = Number.isFinite(numB) && b.year !== 'unknown';

    if (isNumA && isNumB) {
      if (numB !== numA) return numB - numA;
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

  function formatPaperSeason(paper) {
    const yr = (paper.year && paper.year !== 'unknown') ? `${paper.year}年` : '年份未知';
    if (paper.season === '05' || paper.season === '上半年') return `${yr}上半年`;
    if (paper.season === '11' || paper.season === '下半年') return `${yr}下半年`;
    return yr; // 00 or unknown -> just `${year}年`, do NOT show '下半年'!
  }

  function PaperList({
    papers = [],
    onSelectPaper,
    isLoading = false
  }) {
    const [subjectFilter, setSubjectFilter] = useState('');
    const [yearFilter, setYearFilter] = useState('');
    const [completionFilter, setCompletionFilter] = useState('');
    const [searchKeyword, setSearchKeyword] = useState('');

    // Extract available years numerically sorted descending (AC-02)
    const numericYears = Array.from(new Set(
      papers
        .map(p => String(p.year))
        .filter(y => y && y !== 'unknown' && /^\d+$/.test(y))
    )).map(Number).sort((a, b) => b - a).map(String);
    const hasUnknownYear = papers.some(p => p.year === 'unknown');
    const years = ['全部', ...numericYears, ...(hasUnknownYear ? ['unknown'] : [])];

    const filteredPapers = papers.filter(p => {
      if (subjectFilter && p.subject !== subjectFilter) return false;
      if (yearFilter && String(p.year) !== yearFilter) return false;
      const isCompleted = Boolean(p.isCompleted || p.completed);
      if (completionFilter === 'completed' && !isCompleted) return false;
      if (completionFilter === 'uncompleted' && isCompleted) return false;
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const matchesTitle = p.title && p.title.toLowerCase().includes(kw);
        const matchesId = p.id && p.id.toLowerCase().includes(kw);
        if (!matchesTitle && !matchesId) return false;
      }
      return true;
    });

    // AC-02: Numerically sorted descending by year, 下半年 before 上半年, unknown at end
    filteredPapers.sort(comparePapers);

    return div({ className: 'papers-view-container' },
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '历年真题模拟题库'),
          span({ className: 'view-subtitle' }, `共 ${papers.length} 份试卷与收录试题，按年份和科目选择练习`)
        )
      ),

      React.createElement(FilterBar, {
        subjectFilter,
        onSubjectFilterChange: setSubjectFilter,
        yearFilter,
        onYearFilterChange: setYearFilter,
        completionFilter,
        onCompletionFilterChange: setCompletionFilter,
        searchKeyword,
        onSearchKeywordChange: setSearchKeyword,
        availableYears: years,
        onReset: () => {
          setSubjectFilter('');
          setYearFilter('');
          setCompletionFilter('');
          setSearchKeyword('');
        }
      }),

      isLoading ? div({ className: 'loading-state' }, '正在加载试卷目录...') :
      filteredPapers.length === 0 ? div({ className: 'empty-box' },
        p(null, '没有找到符合筛选条件的试卷。请尝试调整科目、年份或完成状态。')
      ) :
      div({ className: 'papers-grid' },
        filteredPapers.map(paper => {
          const isCase = paper.subject === 'case';
          const isCompleted = Boolean(paper.isCompleted || paper.completed);
          return div({ key: paper.id, className: `paper-card ${isCase ? 'case-paper' : 'obj-paper'}` },
            div({ className: 'paper-card-top' },
              span({ className: `badge-paper-type ${isCase ? 'type-case' : 'type-obj'}` },
                isCase ? '下午·案例分析' : '上午·综合知识'
              ),
              span({ className: 'paper-year-tag' }, formatPaperSeason(paper)),
              isCompleted && span({
                className: 'badge-completed-status',
                title: '本地学习记录已完成全部作答并成功交卷'
              }, '✅ 已全部刷完并提交')
            ),
            h3({ className: 'paper-card-title' }, paper.title),
            div({ className: 'paper-card-meta' },
              span({ className: 'meta-item' }, `试题容量：${paper.totalQuestions} 道试题`),
              !isCase && paper.totalQuestions < 75 && span({ className: 'meta-item notice-tag', style: { color: '#2b6cb0', backgroundColor: '#ebf8ff', padding: '1px 6px', borderRadius: '3px' } }, `收录 ${paper.totalQuestions} 题`),
              paper.standardQuestionGroups && span({ className: 'meta-item' }, `题组：${paper.standardQuestionGroups} 组`)
            ),
            div({ className: 'paper-card-actions' },
              button({
                className: 'btn-start-paper btn-primary',
                onClick: () => onSelectPaper(paper.id, paper.subject)
              }, isCase ? '进入案例分析答题 →' : (paper.totalQuestions < 75 ? '进入收录试题练习 →' : '进入上午全真模考 →'))
            )
          );
        })
      )
    );
  }

  return PaperList;
});
