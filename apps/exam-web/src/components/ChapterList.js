/**
 * ChapterList Component
 * Displays knowledge chapters distribution with question volume
 * and quick launch for chapter-focused practice.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.ChapterList = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h2, h3, p, input } = DOM;
  const { useState } = React;

  function ChapterList({
    chapters = [],
    onSelectChapter,
    isLoading = false
  }) {
    const [searchTerm, setSearchTerm] = useState('');

    const filtered = chapters.filter(c => {
      const name = typeof c === 'string' ? c : c.chapter;
      return !searchTerm || name.toLowerCase().includes(searchTerm.toLowerCase());
    });

    return div({ className: 'chapters-view-container' },
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '软件设计师·考点章节特训'),
          span({ className: 'view-subtitle' }, '按知识主题选择专项练习，集中巩固薄弱考点')
        )
      ),

      div({ className: 'chapter-search-box' },
        input({
          type: 'text',
          className: 'search-input',
          placeholder: '搜索章节名（如：计算机系统、操作系统、设计模式）...',
          value: searchTerm,
          onChange: (e) => setSearchTerm(e.target.value)
        }),
        searchTerm && button({
          className: 'btn-clear-search',
          onClick: () => setSearchTerm('')
        }, '×')
      ),

      isLoading ? div({ className: 'loading-state' }, '正在加载考点章节...') :
      filtered.length === 0 ? div({ className: 'empty-box' }, p(null, '未找到匹配章节。')) :
      div({ className: 'chapters-grid' },
        filtered.map((item, idx) => {
          const chName = typeof item === 'string' ? item : item.chapter;
          const objCount = typeof item === 'object' ? item.objectiveCount || 0 : 0;
          const caseCount = typeof item === 'object' ? item.caseCount || 0 : 0;
          const totalQ = objCount + caseCount;

          return div({ key: chName || idx, className: 'chapter-card' },
            div({ className: 'chapter-header' },
              span({ className: 'chapter-index' }, `专题 ${idx + 1}`),
              totalQ > 0 && span({ className: 'chapter-count-badge' }, `共 ${totalQ} 题`)
            ),
            h3({ className: 'chapter-name' }, chName),
            div({ className: 'chapter-breakdown' },
              span({ className: 'breakdown-item' }, `客观选择：${objCount} 题`),
              span({ className: 'breakdown-item' }, `案例分析：${caseCount} 题`)
            ),
            div({ className: 'chapter-actions' },
              button({
                className: 'btn-start-chapter',
                onClick: () => onSelectChapter(chName)
              }, '进入本章特训 →')
            )
          );
        })
      )
    );
  }

  return ChapterList;
});
