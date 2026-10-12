/**
 * Header Component
 * Provides global navigation, active session indicators, auto-save status,
 * timer and offline state indicators.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.Header = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { header, div, h1, span, button, nav } = DOM;

  function Header({
    activeTab,
    onTabChange,
    saveStatus, // 'saved' | 'saving' | 'unsaved' | 'offline'
    lastSavedAt,
    timerSeconds,
    activeSession,
    onBackToSession,
    onBackToHome,
    isChatOpen,
    onToggleChat,
    onOpenSettings
  }) {
    // Format timer
    const formatTime = (totalSec) => {
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    return header({ className: 'app-header' },
      div({ className: 'header-left' },
        div({ className: 'brand-group', onClick: onBackToHome, style: { cursor: 'pointer' } },
          h1({ className: 'app-title' }, '软考备考答题工作台'),
          span({ className: 'app-badge' }, '软件设计师')
        ),
        nav({ className: 'nav-tabs' },
          button({
            className: `nav-tab ${activeTab === 'papers' ? 'active' : ''}`,
            onClick: () => onTabChange('papers')
          }, '历年真题'),
          button({
            className: `nav-tab ${activeTab === 'chapters' ? 'active' : ''}`,
            onClick: () => onTabChange('chapters')
          }, '章节特训'),
          button({
            className: `nav-tab ${activeTab === 'wrong_questions' ? 'active' : ''}`,
            onClick: () => onTabChange('wrong_questions')
          }, '错题本'),
          button({
            className: `nav-tab ${activeTab === 'materials' ? 'active' : ''}`,
            onClick: () => onTabChange('materials')
          }, '复习资料'),
          button({
            className: `nav-tab ${activeTab === 'history' ? 'active' : ''}`,
            onClick: () => onTabChange('history')
          }, '答题历史'),
          button({
            className: `nav-tab ${activeTab === 'review_queue' ? 'active' : ''}`,
            onClick: () => onTabChange('review_queue')
          }, '智能复习')
        )
      ),

      div({ className: 'header-right' },
        // Timer display when in exam session
        timerSeconds !== null && timerSeconds !== undefined && div({ className: 'header-timer' },
          span({ className: 'timer-icon' }, '⏱️'),
          span({ className: 'timer-text' }, formatTime(timerSeconds))
        ),

        // Auto-save Status Indicator
        div({ className: `save-indicator status-${saveStatus || 'saved'}` },
          span({ className: 'status-dot' }),
          span({ className: 'status-text' },
            saveStatus === 'saving' ? '正在自动保存...' :
            saveStatus === 'unsaved' ? '有未保存改动' :
            saveStatus === 'offline' ? '后端失联，草稿仅本地暂存 (未保存至服务端)' :
            lastSavedAt ? `已自动保存 (${lastSavedAt})` : '已自动保存'
          )
        ),

        // Return to active session shortcut
        activeSession && activeSession.status === 'in_progress' && activeTab !== 'exam' && button({
          className: 'btn-resume-header',
          onClick: onBackToSession
        }, '返回当前答题 →'),

        // Global AI Chat Assistant Entry
        button({
          type: 'button',
          className: `btn-header-ai ${isChatOpen ? 'active' : ''}`,
          onClick: onToggleChat,
          title: '开启或关闭 AI 助教'
        }, span({ className: 'header-ai-icon' }, '🤖'), span({ className: 'header-ai-label' }, 'AI 助教')),

        // Global Settings & DB Migration Entry
        button({
          type: 'button',
          className: 'btn-header-settings',
          onClick: onOpenSettings,
          title: '系统设置与数据备份管理'
        }, span({ className: 'header-settings-icon' }, '⚙️'), span({ className: 'header-settings-label' }, '设置'))
      )
    );
  }

  return Header;
});
