/**
 * AnswerSheet Component (答题卡)
 * Displays question grid, answered/unanswered/flagged states,
 * quick navigation jump, overall completion progress, and submit button.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.AnswerSheet = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h3, p } = DOM;

  function AnswerSheet({
    questions = [],
    currentIndex = 0,
    answers = {}, // map of questionId -> answer
    flags = {},   // map of questionId -> boolean
    solutions = {}, // map of questionId -> solution (effectiveAnswer, isCorrect, etc.)
    onJumpToQuestion,
    onSubmitExam,
    isSubmitting = false,
    onSaveAndExit = null,
    practiceMode = 'exam'
  }) {
    const isMobileInitial = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 900px)').matches
      : (typeof window !== 'undefined' && window.innerWidth <= 900);
    const [collapsed, setCollapsed] = React.useState(isMobileInitial);
    const [showConfirmModal, setShowConfirmModal] = React.useState(false);

    const isPracticeMode = practiceMode === 'practice' || practiceMode === 'memorize';
    const totalCount = questions.length;
    const isCase6Exam = totalCount === 6 && questions.every(q => q.subject === 'case');

    // Calculate answered count and practice mode correct/wrong counts
    let answeredCount = 0;
    let correctCount = 0;
    let wrongCount = 0;

    questions.forEach(q => {
      const ans = answers[q.id];
      const isAnswered = ans && (typeof ans === 'string' ? ans.trim().length > 0 : Object.values(ans).some(v => v && v.trim().length > 0));
      if (isAnswered) {
        answeredCount++;
        const isObjective = q.subject !== 'case';
        if (isPracticeMode && isObjective) {
          const sol = solutions && solutions[q.id];
          if (sol) {
            let isCorrect = null;
            if (sol.effectiveAnswer) {
              isCorrect = String(ans).trim().toUpperCase() === String(sol.effectiveAnswer).trim().toUpperCase();
            } else if (typeof sol.isCorrect === 'boolean') {
              isCorrect = sol.isCorrect;
            }
            if (isCorrect === true) correctCount++;
            else if (isCorrect === false) wrongCount++;
          }
        }
      }
    });

    const unansweredCount = totalCount - answeredCount;
    const progressPercent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

    const handlePreSubmit = () => {
      setShowConfirmModal(true);
    };

    const handleConfirmSubmit = () => {
      setShowConfirmModal(false);
      onSubmitExam();
    };

    return div({ className: `answer-sheet-container ${collapsed ? 'collapsed' : ''}` },
      // Toggle button for narrow screens
      button({
        className: 'btn-toggle-sheet',
        onClick: () => setCollapsed(!collapsed),
        title: collapsed ? '展开答题卡' : '收起答题卡'
      }, collapsed
        ? (totalCount > 0
            ? (isPracticeMode && answeredCount > 0
                ? `📋 展开答题卡 (${answeredCount}/${totalCount} · 对${correctCount} 错${wrongCount})`
                : `📋 展开答题卡 (${answeredCount}/${totalCount})`)
            : '📋 展开答题卡')
        : '✕ 收起答题卡'),

      !collapsed && div({ className: 'answer-sheet-content' },
        // Header
        div({ className: 'sheet-header' },
          h3({ className: 'sheet-title' }, '答题卡'),
          span({ className: 'sheet-progress-text' },
            isPracticeMode && answeredCount > 0
              ? `${answeredCount} / ${totalCount} (对 ${correctCount} / 错 ${wrongCount})`
              : `${answeredCount} / ${totalCount} (${progressPercent}%)`
          )
        ),

        // Progress bar
        div({ className: 'progress-bar-bg' },
          div({
            className: 'progress-bar-fill',
            style: { width: `${progressPercent}%` }
          })
        ),

        // Legend
        div({ className: 'sheet-legend' },
          isPracticeMode && div({ className: 'legend-item' },
            span({ className: 'legend-dot dot-correct' }),
            span({ className: 'legend-text' }, '正确')
          ),
          isPracticeMode && div({ className: 'legend-item' },
            span({ className: 'legend-dot dot-wrong' }),
            span({ className: 'legend-text' }, '错误')
          ),
          !isPracticeMode && div({ className: 'legend-item' },
            span({ className: 'legend-dot dot-answered' }),
            span({ className: 'legend-text' }, '已作答')
          ),
          div({ className: 'legend-item' },
            span({ className: 'legend-dot dot-unanswered' }),
            span({ className: 'legend-text' }, '未作答')
          ),
          div({ className: 'legend-item' },
            span({ className: 'legend-dot dot-flagged' }),
            span({ className: 'legend-text' }, '已标记')
          )
        ),

        // Question Number Grid
        div({ className: 'sheet-grid' },
          questions.map((q, idx) => {
            const ans = answers[q.id];
            const isAnswered = ans && (typeof ans === 'string' ? ans.trim().length > 0 : Object.values(ans).some(v => v && v.trim().length > 0));
            const isFlagged = !!flags[q.id];
            const isCurrent = currentIndex === idx;
            const isObjective = q.subject !== 'case';
            const sol = solutions && solutions[q.id];

            let isCorrect = null;
            if (isPracticeMode && isObjective && isAnswered && sol) {
              if (sol.effectiveAnswer) {
                isCorrect = String(ans).trim().toUpperCase() === String(sol.effectiveAnswer).trim().toUpperCase();
              } else if (typeof sol.isCorrect === 'boolean') {
                isCorrect = sol.isCorrect;
              }
            }

            let statusClass = 'status-unanswered';
            if (isAnswered) {
              if (isPracticeMode && isObjective && isCorrect !== null) {
                statusClass = isCorrect ? 'status-correct' : 'status-wrong';
              } else {
                statusClass = 'status-answered';
              }
            }
            if (isFlagged) statusClass += ' status-flagged';
            if (isCurrent) statusClass += ' status-current';

            const labelText = isCase6Exam && (idx === 4 || idx === 5)
              ? `${idx + 1}(选)`
              : String(idx + 1);

            let statusTitle = '未作答';
            if (isAnswered) {
              if (isPracticeMode && isObjective && isCorrect !== null) {
                statusTitle = isCorrect ? '回答正确' : '回答错误';
              } else {
                statusTitle = '已作答';
              }
            }
            if (isFlagged) statusTitle += ' · 已标记';

            const questionTypeLabel = q.subject === 'case' ? '案例' : '客观';
            const electiveTag = isCase6Exam && (idx === 4 || idx === 5) ? '·选做题' : '';

            return button({
              key: q.id || idx,
              className: `sheet-item-btn ${statusClass}`,
              onClick: () => onJumpToQuestion(idx),
              title: `题号 ${idx + 1} (${questionTypeLabel}${electiveTag} · ${statusTitle})`
            },
              span({ className: 'item-num' }, labelText),
              isFlagged && span({ className: 'item-flag-icon' }, '🚩')
            );
          })
        ),

        // Submit & Exit Buttons
        div({ className: 'sheet-submit-section' },
          button({
            className: 'btn-submit-exam',
            disabled: isSubmitting,
            onClick: handlePreSubmit
          }, isSubmitting ? '正在交卷判分...' : '交卷并查看错题报告'),
          onSaveAndExit && button({
            type: 'button',
            className: 'btn-save-exit',
            onClick: onSaveAndExit,
            title: '保存当前答题草稿与进度，稍后可在【答题历史】中随时继续'
          }, '💾 保存进度并退出'),
          p({
            className: 'sheet-free-notice',
            style: { margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary, #64748b)', textAlign: 'center', lineHeight: '1.4' }
          }, '该项目完全免费开源，如果你是花钱买到的，那么你被骗了')
        )
      ),

      // Pre-submit Confirmation Modal
      showConfirmModal && div({ className: 'submit-modal-backdrop' },
        div({ className: 'submit-modal-content' },
          h3({ className: 'submit-modal-title' }, '确认交卷？'),
          p({ className: 'submit-modal-desc' },
            isCase6Exam
              ? `本次案例分析共 6 题（前 4 题必答，试题五/六二选一，有效满分 75 分），您已作答 ${answeredCount} 题。`
              : (unansweredCount > 0
                  ? `本次练习共 ${totalCount} 道试题，您还有 ${unansweredCount} 道题未作答！`
                  : `本次练习共 ${totalCount} 道试题，您已全部作答完毕！`)
          ),
          p({ className: 'submit-modal-note' }, '交卷后系统将自动进行客观题确定性判分，并生成完整错题报告与资料解析。'),
          div({ className: 'submit-modal-actions' },
            button({
              className: 'btn-modal-cancel',
              onClick: () => setShowConfirmModal(false)
            }, '继续答题'),
            button({
              className: 'btn-modal-confirm',
              onClick: handleConfirmSubmit
            }, '确认交卷')
          )
        )
      )
    );
  }

  return AnswerSheet;
});
