/**
 * ReviewQueueView Component
 * Renders spaced repetition queue (Ebbinghaus curve intervals)
 * with priority scores, next review date, interval days, and state.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.ReviewQueueView = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h2, h3, p, table, thead, tbody, tr, th, td } = DOM;

  function ReviewQueueView({
    reviewQueue = [],
    onStartReviewPractice
  }) {
    const dueCount = reviewQueue.filter(item => new Date(item.nextReviewAt) <= new Date()).length;

    return div({ className: 'review-queue-container' },
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '艾宾浩斯智能复习队列'),
          span({ className: 'view-subtitle' }, `依据遗忘曲线加权计算，当前共有 ${reviewQueue.length} 道复习任务，已到期需复习 ${dueCount} 道`)
        ),
        div({ className: 'view-actions' },
          reviewQueue.length > 0 && button({
            className: 'btn-primary-action',
            onClick: () => onStartReviewPractice(reviewQueue.map(item => item.questionId))
          }, '🚀 启动今日智能复习')
        )
      ),

      reviewQueue.length === 0 ? div({ className: 'empty-box' },
        p(null, '复习队列当前为空。当做错试题或完成模考后，系统将自动基于记忆曲线排布复习任务。')
      ) :
      div({ className: 'queue-table-box' },
        table({ className: 'queue-table' },
          thead(null,
            tr(null,
              th(null, '优先级'),
              th(null, '题目标识'),
              th(null, '复习阶段'),
              th(null, '复习间隔 (天)'),
              th(null, '复习次数'),
              th(null, '记忆难度系数'),
              th(null, '计划复习时间')
            )
          ),
          tbody(null,
            reviewQueue.map((item, idx) => {
              const isDue = new Date(item.nextReviewAt) <= new Date();
              return tr({ key: item.id || idx, className: isDue ? 'row-due' : '' },
                td({ className: 'cell-priority' },
                  span({ className: `priority-pill ${item.priorityScore > 5 ? 'high' : 'normal'}` },
                    item.priorityScore.toFixed(1)
                  )
                ),
                td({ className: 'cell-qid' }, item.questionId),
                td(null,
                  span({ className: `state-tag state-${item.state}` },
                    item.state === 'learning' ? '初始记忆' :
                    item.state === 'reviewing' ? '周期复习' : '已巩固掌握'
                  )
                ),
                td(null, `${item.intervalDays || 1} 天`),
                td(null, `${item.repetitions || 0} 次`),
                td(null, (item.easeFactor || 2.5).toFixed(2)),
                td({ className: isDue ? 'text-due' : '' },
                  isDue ? '⚡ 现已到期' : new Date(item.nextReviewAt).toLocaleDateString()
                )
              );
            })
          )
        )
      )
    );
  }

  return ReviewQueueView;
});
