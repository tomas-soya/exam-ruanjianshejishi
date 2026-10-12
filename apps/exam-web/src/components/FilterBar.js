/**
 * FilterBar Component
 * Filtering by Paper Year, Season, Subject, Chapter, Topic and Search Keyword.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.FilterBar = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, input, select, option, label } = DOM;

  function FilterBar({
    subjectFilter,
    onSubjectFilterChange,
    yearFilter,
    onYearFilterChange,
    completionFilter,
    onCompletionFilterChange,
    searchKeyword,
    onSearchKeywordChange,
    availableYears = ['全部', '2026', '2025', '2024', '2023'],
    chapterFilter,
    onChapterFilterChange,
    availableChapters = [],
    onReset
  }) {
    return div({ className: 'filter-bar' },
      div({ className: 'filter-group' },
        label({ className: 'filter-label' }, '题型科目：'),
        div({ className: 'btn-toggle-group' },
          button({
            className: `toggle-btn ${!subjectFilter ? 'active' : ''}`,
            onClick: () => onSubjectFilterChange('')
          }, '全部科目'),
          button({
            className: `toggle-btn ${subjectFilter === 'objective' ? 'active' : ''}`,
            onClick: () => onSubjectFilterChange('objective')
          }, '客观选择题 (上午)'),
          button({
            className: `toggle-btn ${subjectFilter === 'case' ? 'active' : ''}`,
            onClick: () => onSubjectFilterChange('case')
          }, '案例分析题 (下午)')
        )
      ),

      onCompletionFilterChange && div({ className: 'filter-group completion-filter-group' },
        label({ className: 'filter-label' }, '完成状态：'),
        div({ className: 'btn-toggle-group' },
          button({
            type: 'button',
            className: `toggle-btn ${!completionFilter ? 'active' : ''}`,
            onClick: () => onCompletionFilterChange('')
          }, '全部'),
          button({
            type: 'button',
            className: `toggle-btn ${completionFilter === 'completed' ? 'active' : ''}`,
            onClick: () => onCompletionFilterChange('completed')
          }, '已全部刷完并提交'),
          button({
            type: 'button',
            className: `toggle-btn ${completionFilter === 'uncompleted' ? 'active' : ''}`,
            onClick: () => onCompletionFilterChange('uncompleted')
          }, '尚未全部刷完并提交')
        )
      ),

      div({ className: 'filter-group' },
        label({ className: 'filter-label' }, '年份：'),
        select({
          className: 'filter-select',
          value: yearFilter || '全部',
          onChange: (e) => onYearFilterChange(e.target.value === '全部' ? '' : e.target.value)
        },
          availableYears.map(yr => option({ key: yr, value: yr }, yr === '全部' ? '全部年份' : (yr === 'unknown' ? '年份未知' : `${yr}年`)))
        )
      ),

      availableChapters && availableChapters.length > 0 && div({ className: 'filter-group' },
        label({ className: 'filter-label' }, '章节考点：'),
        select({
          className: 'filter-select chapter-select',
          value: chapterFilter || '',
          onChange: (e) => onChapterFilterChange(e.target.value)
        },
          option({ value: '' }, '全部章节'),
          availableChapters.map(ch =>
            option({
              key: typeof ch === 'string' ? ch : ch.chapter,
              value: typeof ch === 'string' ? ch : ch.chapter
            }, typeof ch === 'string' ? ch : `${ch.chapter} (${(ch.objectiveCount || 0) + (ch.caseCount || 0)}题)`)
          )
        )
      ),

      div({ className: 'filter-group search-group' },
        input({
          type: 'text',
          className: 'search-input',
          placeholder: '搜索试卷、考点或关键字...',
          value: searchKeyword || '',
          onChange: (e) => onSearchKeywordChange(e.target.value)
        }),
        searchKeyword && button({
          className: 'btn-clear-search',
          onClick: () => onSearchKeywordChange('')
        }, '×')
      ),

      onReset && button({
        className: 'btn-reset-filters',
        onClick: onReset
      }, '重置筛选')
    );
  }

  return FilterBar;
});
