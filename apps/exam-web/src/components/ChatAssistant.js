/**
 * ChatAssistant Component (AI 助教问答面板)
 * Unified AI Teaching Assistant across 4 Scenarios:
 * - question: Exam question hints, option analysis, and step-by-step problem solving
 * - material: Study guide summaries, core concepts, and mnemonic formulas
 * - report: Post-exam diagnosis, weak area analysis, and personalized review advice
 * - general: Cross-chapter comprehensive Q&A (e.g. transactions vs locks, process sync vs DB concurrency)
 *
 * Implements AC-Q1..AC-Q5:
 * - AC-Q1: 4 context types with clear context header & cross-chapter switching
 * - AC-Q2: Strict exam mode protection with confirmation modal, permanent SQLite persistence, and assisted badge
 * - AC-Q3: Verified material citations linking to canonical chapters with anchor auto-scroll
 * - AC-Q4: Safe Markdown rendering, pure Unicode formulas, <= 500 char input limit, zero secret leakage
 * - AC-Q5: AbortController cascade cancellation, "停止生成" button, no ghost replies
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('react'),
      require('../utils/dom'),
      require('./CodeBlock')
    );
  } else {
    root.ChatAssistant = factory(
      root.React,
      root.DOM,
      root.CodeBlock
    );
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM, CodeBlock) {
  'use strict';

  const { div, span, button, h3, h4, p, textarea, strong, em, pre, code, ul, li } = DOM;
  const { useState, useEffect, useRef } = React;

  /**
   * Safe Inline Markdown Renderer
   * Renders bold, inline code, and text safely with zero external dependencies.
   */
  function renderSafeInline(text) {
    if (!text) return text;
    const parts = [];
    let lastIndex = 0;
    const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(DOM.strong({ key: `b-${match.index}` }, match[2]));
      } else if (match[4]) {
        parts.push(code({ key: `c-${match.index}`, className: 'chat-inline-code' }, match[4]));
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  }

  /**
   * Safe Block Markdown Renderer for Chat Replies
   */
  function renderSafeMarkdownBlocks(markdownText) {
    if (!markdownText) return [];
    const lines = markdownText.replace(/\r\n/g, '\n').split('\n');
    const elements = [];
    let inCode = false;
    let codeLines = [];
    let codeLang = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        if (inCode) {
          elements.push(
            div({ key: `code-${elements.length}`, className: 'chat-code-block' },
              pre(null, code({ className: `language-${codeLang || 'text'}` }, codeLines.join('\n')))
            )
          );
          codeLines = [];
          inCode = false;
        } else {
          inCode = true;
          codeLang = line.trim().slice(3).trim();
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        elements.push(h3({ key: `h1-${i}`, className: 'chat-h3' }, renderSafeInline(trimmed.slice(2))));
      } else if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
        elements.push(h4({ key: `h2-${i}`, className: 'chat-h4' }, renderSafeInline(trimmed.replace(/^#+\s*/, ''))));
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        elements.push(li({ key: `li-${i}`, className: 'chat-li' }, renderSafeInline(trimmed.slice(2))));
      } else if (trimmed.length > 0) {
        elements.push(p({ key: `p-${i}`, className: 'chat-p' }, renderSafeInline(trimmed)));
      }
    }

    if (inCode && codeLines.length > 0) {
      elements.push(
        div({ key: `code-${elements.length}`, className: 'chat-code-block' },
          pre(null, code(null, codeLines.join('\n')))
        )
      );
    }

    return elements;
  }

  function ChatAssistant({
    isOpen,
    onClose,
    context, // { type: 'question'|'material'|'report'|'general', targetId, title, chapter, paperId, sessionId }
    apiClient,
    activeSession,
    onExitExamModeSuccess,
    onOpenMaterialAnchor
  }) {
    // Current effective context (allows switching to general cross-chapter consultation)
    const [effectiveContext, setEffectiveContext] = useState(context || { type: 'general', title: '软考通用备考与跨章节答疑' });
    const [isGeneralOverride, setIsGeneralOverride] = useState(false);

    // Messages: [{ id, role: 'user'|'assistant'|'system', content, citedAnchors, isSufficient, timestamp }]
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isGatewayOffline, setIsGatewayOffline] = useState(false);
    const [showGatewayHelp, setShowGatewayHelp] = useState(false);

    // Strict Exam Confirmation Modal
    const [showExamConfirmModal, setShowExamConfirmModal] = useState(false);
    const [pendingQuestionText, setPendingQuestionText] = useState(null);

    // Abort controller reference for active request
    const abortControllerRef = useRef(null);
    const messagesEndRef = useRef(null);

    // Synchronize effectiveContext when context prop changes
    useEffect(() => {
      if (context) {
        setEffectiveContext(context);
        setIsGeneralOverride(false);
      }
    }, [context]);

    // Auto-scroll to latest message
    useEffect(() => {
      if (messagesEndRef.current && isOpen) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, [messages, isGenerating, isOpen]);

    // Cleanup abort controller on unmount or close
    useEffect(() => {
      return () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
      };
    }, []);

    // Initial greeting when conversation is empty
    useEffect(() => {
      if (messages.length === 0) {
        const welcomeMessage = getInitialGreeting(effectiveContext);
        setMessages([welcomeMessage]);
      }
    }, [effectiveContext]);

    function getInitialGreeting(ctx) {
      let welcomeText = '同学你好！我是你的软考 AI 助教。';
      if (ctx.type === 'question') {
        welcomeText += ` 当前正在做题【${ctx.title || '试题'}】。你可以询问解题思路、选项辨析、考点判定口诀等。（注：严格考试模式下需确认退出模考方可获得辅导解答）`;
      } else if (ctx.type === 'material') {
        welcomeText += ` 当前正在研读讲义【${ctx.title || '章节讲义'}】。针对本章节核心原理、历年考察频次与易错陷阱，欢迎随时提问。`;
      } else if (ctx.type === 'report') {
        welcomeText += ` 模考已完成！我可以为你分析本次练习的薄弱考点、归纳错题知识链并提供专项突破建议。`;
      } else {
        welcomeText += ` 我支持软考全科大纲答疑与跨章节综合咨询（例如：数据库事务隔离与封锁协议、操作系统进程同步与并发控制等）。请随时向我提问！`;
      }

      return {
        id: 'msg-welcome',
        role: 'assistant',
        content: welcomeText,
        citedAnchors: [],
        isSufficient: true,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      };
    }

    // Toggle between current context and general cross-chapter Q&A
    const handleToggleGeneralContext = () => {
      if (isGeneralOverride) {
        setIsGeneralOverride(false);
        setEffectiveContext(context || { type: 'general', title: '软考通用备考与跨章节答疑' });
      } else {
        setIsGeneralOverride(true);
        setEffectiveContext({
          type: 'general',
          title: '跨章节综合答疑与备考辅导',
          sessionId: activeSession ? activeSession.id : undefined
        });
      }
    };

    // Quick starter prompt pills
    const getQuickPrompts = () => {
      switch (effectiveContext.type) {
        case 'question':
          return [
            '请给出本题解题思路与考点分析',
            '请逐一辨析各选项的正误原因',
            '本题有哪些容易混淆的做题陷阱？'
          ];
        case 'material':
          return [
            '本章节历年高频考点口诀有哪些？',
            '请总结本节必须掌握的核心概念与公式',
            '与本章关联的典型真题出题方式'
          ];
        case 'report':
          return [
            '根据本次做题情况，诊断我的薄弱章节',
            '如何针对本次错题制定温习计划？',
            '请归纳本次做题的易错概念对比'
          ];
        case 'general':
        default:
          return [
            '比较数据库事务隔离级别与两阶段锁协议',
            '解析操作系统进程同步与PV操作经典题型',
            '设计模式中结构型与行为型的核心区别'
          ];
      }
    };

    // Send a message
    const doSendMessage = async (textToSend) => {
      const text = (textToSend || inputMessage).trim();
      if (!text || isGenerating) return;

      if (text.length > 500) {
        setErrorMessage('提问内容不能超过 500 字符');
        return;
      }

      setErrorMessage(null);
      setIsGatewayOffline(false);
      setShowGatewayHelp(false);
      setInputMessage('');

      const userMsg = {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, userMsg]);
      setIsGenerating(true);

      // Create new AbortController
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Build recent history (up to 10 turns)
      const recentHistory = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      try {
        const payload = {
          context: {
            ...effectiveContext,
            sessionId: (activeSession && activeSession.id) || effectiveContext.sessionId
          },
          userMessage: text,
          history: recentHistory
        };

        const resData = await apiClient.chat(payload, controller.signal);

        const assistantMsg = {
          id: `msg-asst-${Date.now()}`,
          role: 'assistant',
          content: resData.replyText,
          citedAnchors: resData.citedAnchors || [],
          isSufficient: resData.isSufficient !== false,
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => [...prev, assistantMsg]);
      } catch (err) {
        // 1. Handle Abort / User Stop (AC-Q5 / OFFLINE-02)
        if (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'))) {
          setMessages(prev => [...prev, {
            id: `msg-abort-${Date.now()}`,
            role: 'system',
            content: '⏹ 已停止生成回答。',
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          }]);
          return;
        }

        // 2. Handle Strict Exam Mode Disabled (AC-Q2 / OFFLINE-02)
        if (err.status === 403 || err.code === 'EXAM_MODE_CHAT_DISABLED') {
          setPendingQuestionText(text);
          setShowExamConfirmModal(true);
          return;
        }

        // 3. Handle Gateway Unavailable (503) (OFFLINE-01)
        if (err.status === 503 || err.code === 'CHAT_SERVICE_UNAVAILABLE') {
          setIsGatewayOffline(true);
          setErrorMessage('当前配置的本地 AI 网关暂不可达，请检查网关服务是否已启动运行。');
          return;
        }

        // 4. Handle Timeout (504 / 408 / timeout) (OFFLINE-02)
        if (err.status === 504 || err.status === 408 || err.code === 'CHAT_TIMEOUT' || (err.message && err.message.toLowerCase().includes('timeout'))) {
          setErrorMessage('本次提问未在时间预算内完成（请求超时），请稍后手动重试。');
          return;
        }

        // 5. Handle Input Validation (400) (OFFLINE-02)
        if (err.status === 400 || err.code === 'MESSAGE_TOO_LONG' || err.code === 'INVALID_REQUEST') {
          setErrorMessage('提问内容超出限制或格式有误，请调整后重试。');
          return;
        }

        // 6. Generic Sanitized Error (OFFLINE-03 - zero credential/stack/request-body leakage)
        setErrorMessage('问答服务请求失败，请稍后重试。');
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    };

    // Stop Generation Button (AC-Q5)
    const handleStopGeneration = () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsGenerating(false);
    };

    // User Confirms Exiting Strict Exam Mode (AC-Q2)
    const handleConfirmExitExam = async () => {
      if (!activeSession || !activeSession.id) {
        setShowExamConfirmModal(false);
        return;
      }

      try {
        const exitResult = await apiClient.exitExamMode(activeSession.id);
        setShowExamConfirmModal(false);

        if (onExitExamModeSuccess) {
          onExitExamModeSuccess(exitResult);
        }

        // Auto-retry the pending question
        if (pendingQuestionText) {
          const q = pendingQuestionText;
          setPendingQuestionText(null);
          setTimeout(() => doSendMessage(q), 200);
        }
      } catch (err) {
        alert(`退出考试模式失败：${err.message}`);
      }
    };

    const handleCancelExitExam = () => {
      setShowExamConfirmModal(false);
      setPendingQuestionText(null);
      setMessages(prev => [...prev, {
        id: `msg-cancelled-${Date.now()}`,
        role: 'system',
        content: '保持严格模考中：未退出模考，已取消 AI 助教辅导。',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }]);
    };

    const handleClearChat = () => {
      const welcome = getInitialGreeting(effectiveContext);
      setMessages([welcome]);
      setErrorMessage(null);
      setIsGatewayOffline(false);
      setShowGatewayHelp(false);
    };

    if (!isOpen) return null;

    const charCount = inputMessage.length;
    const isOverLimit = charCount > 500;

    return div({ className: 'chat-assistant-overlay', onClick: onClose },
      div({ className: 'chat-assistant-drawer', onClick: (e) => e.stopPropagation() },
        // 1. Drawer Header
        div({ className: 'chat-drawer-header' },
          div({ className: 'chat-header-main' },
            div({ className: 'chat-title-row' },
              span({ className: 'chat-bot-icon' }, '🤖'),
              h3({ className: 'chat-drawer-title' }, 'AI 助教问答'),
              span({ className: 'chat-ai-model-tag' }, '考点讲解与答疑')
            ),
            div({ className: 'chat-context-banner' },
              span({ className: 'context-type-pill' },
                effectiveContext.type === 'question' ? '📝 试题上下文' :
                effectiveContext.type === 'material' ? '📖 讲义上下文' :
                effectiveContext.type === 'report' ? '📊 报告上下文' : '🌐 跨章节综合'
              ),
              span({ className: 'context-title-text', title: effectiveContext.title },
                effectiveContext.title || '当前页面'
              ),
              button({
                type: 'button',
                className: `btn-context-switch ${isGeneralOverride ? 'is-general' : ''}`,
                onClick: handleToggleGeneralContext,
                title: isGeneralOverride ? '切回当前页面特定上下文' : '切换为跨章节通用咨询'
              }, isGeneralOverride ? '↩ 切回页面' : '🌐 跨章节')
            )
          ),
          button({
            type: 'button',
            className: 'btn-chat-close',
            onClick: onClose,
            title: '关闭助教面板'
          }, '✕')
        ),

        // 2. Chat Message List
        div({ className: 'chat-messages-container' },
          messages.map(msg =>
            div({ key: msg.id, className: `chat-message-row ${msg.role}` },
              msg.role === 'assistant' && div({ className: 'chat-avatar' }, '🤖'),
              div({ className: `chat-bubble ${msg.role}` },
                div({ className: 'chat-bubble-content' },
                  msg.role === 'assistant'
                    ? renderSafeMarkdownBlocks(msg.content)
                    : p(null, msg.content)
                ),

                // Citations list (AC-Q3)
                msg.citedAnchors && msg.citedAnchors.length > 0 && div({ className: 'chat-citations-wrapper' },
                  span({ className: 'citations-title' }, '📚 关联考点讲义（点击直达）：'),
                  div({ className: 'citations-chip-list' },
                    msg.citedAnchors.map((anchor, idx) =>
                      button({
                        key: idx,
                        type: 'button',
                        className: 'citation-chip-btn',
                        onClick: () => onOpenMaterialAnchor && onOpenMaterialAnchor(anchor),
                        title: `跳转阅读《${anchor.chapter}》：${anchor.heading}`
                      },
                        span({ className: 'citation-icon' }, '📖'),
                        span({ className: 'citation-text' }, `${anchor.chapter} · ${anchor.heading}`)
                      )
                    )
                  )
                ),

                // Material Insufficiency Notice
                msg.isSufficient === false && div({ className: 'chat-insufficient-note' },
                  '💡 本地资料未直接匹配到该专题，以下为通用解答，请结合题目核对。'
                ),

                div({ className: 'chat-time-meta' }, msg.timestamp)
              ),
              msg.role === 'user' && div({ className: 'chat-avatar user' }, '👤')
            )
          ),

          // Generating thinking status
          isGenerating && div({ className: 'chat-message-row assistant' },
            div({ className: 'chat-avatar' }, '🤖'),
            div({ className: 'chat-bubble assistant thinking' },
              div({ className: 'thinking-dots' },
                span({ className: 'dot' }),
                span({ className: 'dot' }),
                span({ className: 'dot' })
              ),
              span({ className: 'thinking-label' }, '助教正在检索 21 章节讲义并梳理考点...')
            )
          ),

          div({ ref: messagesEndRef })
        ),

        // Quick Starter Prompts
        !isGenerating && div({ className: 'chat-quick-prompts-bar' },
          getQuickPrompts().map((prompt, idx) =>
            button({
              key: idx,
              type: 'button',
              className: 'quick-prompt-btn',
              onClick: () => doSendMessage(prompt)
            }, prompt)
          )
        ),

        // Error message banner (OFFLINE-01..03)
        errorMessage && div({ className: 'chat-error-banner' },
          div({ className: 'chat-error-main' },
            span({ className: 'error-icon' }, '⚠️'),
            span({ className: 'error-text' }, errorMessage),
            isGatewayOffline && button({
              type: 'button',
              className: 'btn-help-guide',
              onClick: () => setShowGatewayHelp(prev => !prev),
              title: '查看本地 AI 网关使用与排查说明'
            }, showGatewayHelp ? '收起排查说明' : '查看排查说明 📖')
          ),
          button({
            type: 'button',
            className: 'btn-dismiss-error',
            onClick: () => {
              setErrorMessage(null);
              setIsGatewayOffline(false);
              setShowGatewayHelp(false);
            },
            title: '关闭提示'
          }, '✕')
        ),

        // Gateway Troubleshooting Help Guide Panel (OFFLINE-01)
        showGatewayHelp && div({ className: 'gateway-help-panel' },
          div({ className: 'gateway-help-header' },
            h4({ className: 'gateway-help-title' }, '🛠️ 本地 AI 网关排查说明'),
            button({
              type: 'button',
              className: 'btn-close-help',
              onClick: () => setShowGatewayHelp(false),
              title: '关闭排查说明'
            }, '✕')
          ),
          div({ className: 'gateway-help-content' },
            p(null, '1. 打开设置，确认 AI 接口地址、模型名称和密钥已填写，并测试连接。'),
            p(null, '2. 启动服务指引：可在 PowerShell 终端中执行启动脚本（详见客户端手册 docs/LOCAL_CLIENT.md）。'),
            p(null, '3. 离线不影响做题：本地 AI 助教不可达时，客观题与案例题正常作答、草稿自动保存、成绩单交卷与答题历史查阅 100% 正常可用。')
          )
        ),

        // 3. Stop Generation Bar (AC-Q5)
        isGenerating && div({ className: 'chat-stop-bar' },
          button({
            type: 'button',
            className: 'btn-stop-generating',
            onClick: handleStopGeneration
          }, '⏹ 停止生成')
        ),

        // 4. Input Area (AC-Q4)
        div({ className: 'chat-input-section' },
          textarea({
            className: `chat-textarea ${isOverLimit ? 'over-limit' : ''}`,
            placeholder: '输入问题，向 AI 助教提问...（Enter 发送，Shift+Enter 换行）',
            value: inputMessage,
            onChange: (e) => setInputMessage(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSendMessage();
              }
            },
            disabled: isGenerating,
            rows: 2
          }),
          div({ className: 'chat-input-footer' },
            div({ className: 'input-footer-left' },
              span({ className: `char-counter ${isOverLimit ? 'warn' : ''}` },
                `${charCount} / 500`
              ),
              button({
                type: 'button',
                className: 'btn-clear-chat',
                onClick: handleClearChat,
                title: '清空当前对话'
              }, '🗑 清空对话')
            ),
            button({
              type: 'button',
              className: 'btn-send-message',
              onClick: () => doSendMessage(),
              disabled: isGenerating || isOverLimit || !inputMessage.trim()
            }, isGenerating ? '生成中...' : '发送 ➢')
          )
        ),

        // 5. Strict Exam Confirmation Modal (AC-Q2)
        showExamConfirmModal && div({ className: 'exam-chat-modal-backdrop' },
          div({ className: 'exam-chat-confirm-modal' },
            h4({ className: 'confirm-title' }, '⚠️ 退出严格模考确认'),
            p({ className: 'confirm-desc' },
              '严格考试模式下已禁用 AI 助教问答。若需要 AI 辅导，请确认退出严格模考并切换至辅助练习模式（此操作将永久记录，成绩单无法作为正式模考）。'
            ),
            p({ className: 'confirm-notice' },
              '退出后，系统将为您永久标记【辅助练习】，并在最终成绩单清晰体现，但您可畅享 AI 助教的考点梳理与思路指引。'
            ),
            div({ className: 'confirm-actions' },
              button({
                type: 'button',
                className: 'btn-cancel-exit',
                onClick: handleCancelExitExam
              }, '保持严格模考'),
              button({
                type: 'button',
                className: 'btn-confirm-exit',
                onClick: handleConfirmExitExam
              }, '确认退出并使用 AI 辅导')
            )
          )
        )
      )
    );
  }

  return ChatAssistant;
});
