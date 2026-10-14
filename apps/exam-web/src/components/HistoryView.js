/**
 * HistoryView Component (答题历史)
 * Displays user's exam and practice history, distinguishing in-progress
 * drafts from submitted exam reports, with session mode badges, progress stats,
 * and reliable resume/report navigation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.HistoryView = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h2, h3, p, strong } = DOM;
  const { useState } = React;

  function HistoryView({
    sessions = [],
    isLoading = false,
    onResumeSession,
    onViewReport,
    onRefresh,
    onDeleteSession
  }) {
    const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'in_progress' | 'submitted'
    const [confirmingSessionId, setConfirmingSessionId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState(null);

    const handleDeleteClick = (sessionId) => {
      setDeleteErrorMessage(null);
      // Support native window.confirm if requested or hook configured
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && window.__AUTO_CONFIRM_DIALOG__) {
        const ok = window.confirm('确定要删除此次答题记录吗？仅删除此次答题记录，不影响错题本和复习资料。');
        if (ok) {
          executeDelete(sessionId);
          return;
        }
      }
      setConfirmingSessionId(sessionId);
    };

    const executeDelete = async (sessionId) => {
      if (deletingId) return; // avoid duplicate submission
      setDeletingId(sessionId);
      setDeleteErrorMessage(null);
      try {
        if (onDeleteSession) {
          await onDeleteSession(sessionId);
        }
        setConfirmingSessionId(null);
        if (onRefresh) {
          await onRefresh();
        }
      } catch (err) {
        setDeleteErrorMessage(`删除失败，记录已保留：${err.message || '网络或服务端异常'}`);
      } finally {
        setDeletingId(null);
      }
    };

    const filteredSessions = sessions.filter(s => {
      if (filterStatus === 'in_progress') return s.status === 'in_progress';
      if (filterStatus === 'submitted') return s.status === 'submitted';
      return true;
    });

    const inProgressCount = sessions.filter(s => s.status === 'in_progress').length;
    const submittedCount = sessions.filter(s => s.status === 'submitted').length;

    const formatModeTag = (mode) => {
      switch (mode) {
        case 'practice': return '💡 练习模式';
        case 'memorize': return '📖 记忆模式';
        case 'exam':
        default:
          return '📝 考试模式';
      }
    };

    const formatSourceTag = (sessionMode) => {
      switch (sessionMode) {
        case 'chapter': return '章节特训';
        case 'wrong_questions': return '错题再练';
        case 'paper':
        default:
          return '历年真题';
      }
    };

    const formatDate = (isoString) => {
      if (!isoString) return '—';
      try {
        const d = new Date(isoString);
        return d.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        return isoString;
      }
    };

    return div({ className: 'history-view-container' },
      // Header Bar
      div({ className: 'view-header-bar' },
        div({ className: 'view-title-group' },
          h2({ className: 'view-title' }, '答题历史与模考记录'),
          span({ className: 'view-subtitle' },
            `共记录 ${sessions.length} 次练习（${inProgressCount} 个未完成草稿，${submittedCount} 次已交卷模考）`
          )
        ),
        div({ className: 'view-actions' },
          onRefresh && button({
            className: 'btn-refresh-history',
            onClick: onRefresh,
            disabled: isLoading
          }, isLoading ? '正在刷新...' : '🔄 刷新记录')
        )
      ),

      // Filter Toolbar
      div({ className: 'history-filter-toolbar' },
        div({ className: 'filter-tabs-group' },
          button({
            className: `btn-filter-tab ${filterStatus === 'all' ? 'active' : ''}`,
            onClick: () => setFilterStatus('all')
          }, `全部记录 (${sessions.length})`),
          button({
            className: `btn-filter-tab in-progress ${filterStatus === 'in_progress' ? 'active' : ''}`,
            onClick: () => setFilterStatus('in_progress')
          }, `未完成作答 (${inProgressCount})`),
          button({
            className: `btn-filter-tab submitted ${filterStatus === 'submitted' ? 'active' : ''}`,
            onClick: () => setFilterStatus('submitted')
          }, `已完成模考 (${submittedCount})`)
        )
      ),

      deleteErrorMessage && div({ className: 'alert-box warning history-delete-error' },
        p(null, deleteErrorMessage)
      ),

      // Sessions List
      div({ className: 'history-sessions-list' },
        isLoading && div({ className: 'history-loading-indicator' }, '正在加载答题历史...'),

        !isLoading && filteredSessions.length === 0 && div({ className: 'history-empty-card' },
          p({ className: 'empty-main-text' },
            filterStatus === 'in_progress'
              ? '当前没有进行中的答题草稿，所有练习均已交卷或未开始。'
              : filterStatus === 'submitted'
              ? '暂无已完成的模考成绩报告，快去真题或章节库练习吧！'
              : '暂无答题记录，选择一套历年真题开始首次自测！'
          )
        ),

        !isLoading && filteredSessions.map((s) => {
          const isInProgress = s.status === 'in_progress';
          const answered = s.answeredCount || 0;
          const total = s.totalQuestions || 0;
          const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

          return div({
            key: s.id,
            className: `history-card ${isInProgress ? 'is-in-progress' : 'is-submitted'}`
          },
            div({ className: 'history-card-header' },
              div({ className: 'card-tags-row' },
                span({ className: `status-badge ${isInProgress ? 'in-progress' : 'submitted'}` },
                  isInProgress ? '⏳ 未完成作答' : '✅ 已完成交卷'
                ),
                span({ className: `mode-badge ${s.practiceMode || 'exam'}` },
                  formatModeTag(s.practiceMode)
                ),
                span({ className: 'source-badge' }, formatSourceTag(s.sessionMode)),
                (s.answersRevealed || s.assistanceUsed || s.practiceMode === 'practice') && span({ className: 'revealed-badge badge-assisted-practice' }, s.assistanceUsed ? '🤖 辅助练习' : '⚠️ 已看答案')
              ),
              span({ className: 'card-time-text' },
                isInProgress
                  ? `最近作答：${formatDate(s.updatedAt || s.createdAt)}`
                  : `交卷时间：${formatDate(s.submittedAt || s.updatedAt)}`
              )
            ),

            div({ className: 'history-card-body' },
              h3({ className: 'session-card-title' }, s.title || '试卷模考练习'),

              isInProgress ? div({ className: 'session-progress-row' },
                div({ className: 'progress-info-text' },
                  span(null, '答题进度：'),
                  strong(null, `${answered} / ${total} 题`),
                  span({ className: 'progress-percent-label' }, ` (${pct}%)`)
                ),
                div({ className: 'progress-bar-track' },
                  div({
                    className: 'progress-bar-val',
                    style: { width: `${pct}%` }
                  })
                )
              ) : (() => {
                const isCaseSession = (s.paperId && s.paperId.includes('case')) ||
                  (s.title && s.title.includes('案例')) ||
                  (s.sessionMode === 'paper' && total === 6 && (!s.paperId || !s.paperId.includes('objective')));
                const effectiveMaxScore = (isCaseSession && total === 6) ? 75 : (s.maxScore || (isCaseSession ? total * 15 : total));
                const effectiveTotalQuestions = (isCaseSession && total === 6) ? 5 : total;
                const effectiveScore = s.score !== null && s.score !== undefined ? s.score : 0;
                const accuracyPct = typeof s.accuracy === 'number'
                  ? Math.min(100, Math.max(0, Math.round(s.accuracy * 100)))
                  : (effectiveMaxScore > 0 && typeof s.score === 'number'
                      ? Math.min(100, Math.max(0, Math.round((s.score / effectiveMaxScore) * 100)))
                      : null);

                return div({ className: 'session-score-row' },
                  div({ className: 'score-tag-item' },
                    span({ className: 'tag-label' }, '模考得分：'),
                    strong({ className: 'tag-val score-highlight' }, s.score == null ? '待评分' : `${effectiveScore} / ${effectiveMaxScore} 分`)
                  ),
                  div({ className: 'score-tag-item' },
                    span({ className: 'tag-label' }, isCaseSession ? '做题得分率：' : '做题正确率：'),
                    strong({ className: 'tag-val' }, accuracyPct !== null ? `${accuracyPct}%` : '—')
                  ),
                  div({ className: 'score-tag-item' },
                    span({ className: 'tag-label' }, '已作答：'),
                    span({ className: 'tag-val' }, `${Math.min(answered, effectiveTotalQuestions)} / ${effectiveTotalQuestions} 题`)
                  )
                );
              })()
            ),

            div({ className: 'history-card-footer' },
              confirmingSessionId === s.id ? div({ className: 'delete-confirm-box' },
                span({ className: 'confirm-warning-text' }, '仅删除此次答题记录，不影响错题及复习资料。确认删除？'),
                div({ className: 'confirm-buttons-group' },
                  button({
                    type: 'button',
                    className: 'btn-confirm-delete',
                    disabled: deletingId === s.id,
                    onClick: () => executeDelete(s.id)
                  }, deletingId === s.id ? '正在删除...' : '确定删除'),
                  button({
                    type: 'button',
                    className: 'btn-cancel-delete',
                    disabled: deletingId === s.id,
                    onClick: () => { setConfirmingSessionId(null); setDeleteErrorMessage(null); }
                  }, '取消')
                )
              ) : div({ className: 'card-actions-row' },
                isInProgress ? button({
                  type: 'button',
                  className: 'btn-action-resume',
                  onClick: () => onResumeSession && onResumeSession(s.id)
                }, '继续答题 →') : button({
                  type: 'button',
                  className: 'btn-action-report',
                  onClick: () => onViewReport && onViewReport(s.id)
                }, '查看成绩报告 📄'),
                button({
                  type: 'button',
                  className: 'btn-action-delete btn-delete-session',
                  'aria-label': `删除记录 ${s.title || ''}`,
                  disabled: Boolean(deletingId),
                  onClick: () => handleDeleteClick(s.id)
                }, '🗑️ 删除记录')
              )
            )
          );
        })
      )
    );
  }

  return HistoryView;
});
