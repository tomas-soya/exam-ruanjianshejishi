/**
 * WrongQuestionsView Component
 * Manages personal wrong question notebook, filtering by chapter and mastery state,
 * with quick restart of wrong question practice sessions.
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
  const { useState } = React;

  function WrongQuestionsView({
    wrongQuestions = [],
    chapters = [],
    onStartWrongPractice,
    onToggleMastered
  }) {
    const [selectedChapter, setSelectedChapter] = useState('');
    const [filterMastered, setFilterMastered] = useState('all'); // 'all' | 'unmastered' | 'mastered'

    const filtered = wrongQuestions.filter(item => {
      if (selectedChapter && item.chapter !== selectedChapter) return false;
      if (filterMastered === 'unmastered' && item.mastered) return false;
      if (filterMastered === 'mastered' && !item.mastered) return false;
      return true;
    });

    const unmasteredCount = wrongQuestions.filter(q => !q.mastered).length;

    return div({ className: 'wrong-questions-container' },
      // Header
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '我的错题本'),
          span({ className: 'view-subtitle' }, `共累计 ${wrongQuestions.length} 道错题，待强化巩固 ${unmasteredCount} 道`)
        ),
        div({ className: 'view-actions' },
          unmasteredCount > 0 && button({
            className: 'btn-primary-action',
            onClick: () => onStartWrongPractice(filtered.filter(q => !q.mastered).map(q => q.questionId))
          }, '🔥 开始错题专项特训')
        )
      ),

      // Filter Toolbar
      div({ className: 'wrong-filter-toolbar' },
        div({ className: 'filter-item' },
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
        ),

        div({ className: 'filter-item' },
          span({ className: 'filter-label' }, '掌握状态：'),
          button({
            className: `btn-filter-tag ${filterMastered === 'all' ? 'active' : ''}`,
            onClick: () => setFilterMastered('all')
          }, '全部'),
          button({
            className: `btn-filter-tag danger ${filterMastered === 'unmastered' ? 'active' : ''}`,
            onClick: () => setFilterMastered('unmastered')
          }, `待巩固 (${unmasteredCount})`),
          button({
            className: `btn-filter-tag success ${filterMastered === 'mastered' ? 'active' : ''}`,
            onClick: () => setFilterMastered('mastered')
          }, `已掌握 (${wrongQuestions.length - unmasteredCount})`)
        )
      ),

      // List
      filtered.length === 0 ? div({ className: 'empty-box' },
        p(null, '暂无符合筛选条件的错题记录。保持良好刷题习惯！')
      ) :
      div({ className: 'wrong-items-grid' },
        filtered.map(item =>
          div({ key: item.id || item.questionId, className: `wrong-item-card ${item.mastered ? 'mastered' : ''}` },
            div({ className: 'wrong-card-header' },
              span({ className: 'wrong-paper-tag' }, item.paperId || '历年真题'),
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
                onClick: () => onToggleMastered(item.id || item.questionId, !item.mastered)
              }, item.mastered ? '移回待强化' : '✓ 标记为已掌握')
            )
          )
        )
      )
    );
  }

  return WrongQuestionsView;
});
