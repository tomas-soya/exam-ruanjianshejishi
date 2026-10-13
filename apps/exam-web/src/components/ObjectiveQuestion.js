/**
 * ObjectiveQuestion Component
 * Renders sanitized objective multiple-choice question (options A, B, C, D),
 * code snippets, diagrams, option selection, and flagging.
 *
 * Supports 3 Delivery Modes (AC-A2):
 * - exam: strict answer isolation (never renders answers/analysis)
 * - practice: real-time feedback upon selection (shows standard answer, analysis, correctness)
 * - memorize: immediate upfront reveal of standard answer and analysis without scoring
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('react'),
      require('../utils/dom'),
      require('./CodeBlock'),
      require('./ImageModal')
    );
  } else {
    root.ObjectiveQuestion = factory(
      root.React,
      root.DOM,
      root.CodeBlock,
      root.ImageModal
    );
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM, CodeBlock, ImageModal) {
  'use strict';

  const { div, span, button, p, img, h3, h4 } = DOM;
  const { useState, useEffect } = React;

  function normalizeAssetUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
    if (!url.startsWith('/')) return '/' + url;
    return url;
  }

  function ObjectiveQuestion({
    question,
    currentIndex,
    totalQuestions,
    userAnswer,
    onAnswerChange,
    isFlagged,
    onToggleFlag,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
    practiceMode = 'exam',
    solution = null,
    onOpenChat
  }) {
    const [modalImage, setModalImage] = useState(null);

    // Keyboard shortcuts A, B, C, D to select option
    useEffect(() => {
      const handleKeyDown = (e) => {
        // Do not trigger if user is typing in input or textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const key = e.key.toUpperCase();
        if (['A', 'B', 'C', 'D'].includes(key)) {
          const opt = question.options && question.options.find(o => o.key.toUpperCase() === key);
          if (opt) {
            onAnswerChange(opt.key);
          }
        } else if (e.key === 'ArrowRight' && hasNext) {
          onNext();
        } else if (e.key === 'ArrowLeft' && hasPrev) {
          onPrev();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [question, onAnswerChange, hasNext, hasPrev, onNext, onPrev]);

    if (!question) return null;

    // Filter code blocks and images: only type === 'stem' allowed for questions, excluding avatar / decorative icons
    const stemCodeBlocks = (question.codeBlocks || []).filter(cb => typeof cb === 'string' || !cb.type || cb.type === 'stem');
    const stemImages = (question.images || []).filter(img => {
      if (!img) return false;
      if (img.type && img.type !== 'stem') return false;
      const url = String(img.sourceUrl || img.source_url || '').toLowerCase();
      const local = String(img.localPath || img.local_path || '').toLowerCase();
      if (url.includes('avatars.githubusercontent.com') || url.includes('/avatar') || local.includes('/avatar')) return false;
      return true;
    });

    const isMemorizeMode = practiceMode === 'memorize';
    const isPracticeMode = practiceMode === 'practice';
    const hasRevealedSolution = (isMemorizeMode || (isPracticeMode && userAnswer)) && solution;

    const effectiveAnswer = solution ? solution.effectiveAnswer : null;
    const isUserCorrect = userAnswer && effectiveAnswer ? (String(userAnswer).trim().toUpperCase() === String(effectiveAnswer).trim().toUpperCase()) : null;

    return div({ className: `question-card objective-card mode-${practiceMode}` },
      // Card Header
      div({ className: 'card-header' },
        div({ className: 'question-meta' },
          span({ className: 'question-index-tag' }, `第 ${currentIndex + 1} / ${totalQuestions} 题`),
          span({ className: 'subject-type-badge' }, '单项选择题'),
          span({ className: `practice-mode-tag mode-${practiceMode}` },
            isMemorizeMode ? '📖 记忆模式' : isPracticeMode ? '💡 练习模式' : '📝 考试模式'
          ),
          question.chapter && span({ className: 'chapter-badge' }, question.chapter)
        ),
        div({ className: 'card-actions' },
          onOpenChat && button({
            type: 'button',
            className: 'btn-ask-chat',
            onClick: () => onOpenChat({
              type: 'question',
              targetId: question.id,
              title: `试题 ${currentIndex + 1}（${question.chapter || '单选题'}）`,
              chapter: question.chapter
            }),
            title: '针对当前题目咨询 AI 助教'
          }, '🤖 问AI助教'),
          button({
            className: `btn-flag ${isFlagged ? 'flagged' : ''}`,
            onClick: onToggleFlag,
            title: isFlagged ? '取消标记' : '标记该题稍后复查'
          }, isFlagged ? '🚩 已标记' : '⚐ 标记本题')
        )
      ),

      // Question Stem
      div({ className: 'question-stem-section' },
        p({ className: 'question-public-id' }, `题号：${question.id}`),
        p({ className: 'question-stem-text' }, question.questionStem)
      ),

      // Code blocks (if any)
      stemCodeBlocks.length > 0 && div({ className: 'question-code-blocks' },
        stemCodeBlocks.map((cb, idx) =>
          React.createElement(CodeBlock, {
            key: idx,
            code: typeof cb === 'string' ? cb : (cb.code || ''),
            language: (typeof cb === 'object' && cb.language) ? cb.language : 'c',
            title: `代码片段 ${idx + 1}`
          })
        )
      ),

      // Stem Images (if any)
      stemImages.length > 0 && div({ className: 'question-images-section' },
        stemImages.map((imgAsset, idx) => {
          const imgSrc = normalizeAssetUrl(imgAsset.localPath || imgAsset.sourceUrl);
          return div({ key: idx, className: 'image-thumbnail-container' },
            img({
              src: imgSrc,
              alt: `试题附图 ${idx + 1}`,
              className: 'stem-image-thumb',
              onClick: () => setModalImage(imgSrc)
            }),
            span({
              className: 'img-zoom-hint',
              onClick: () => setModalImage(imgSrc)
            }, '🔍 点击放大查看附图')
          );
        })
      ),

      // Options (A, B, C, D)
      div({ className: 'options-section' },
        div({ className: 'options-header' },
          span({ className: 'options-title' },
            isMemorizeMode ? '本题选项与标准答案：' : '请选择正确答案：'
          ),
          !isMemorizeMode && span({ className: 'options-shortcut-tip' }, '支持快捷键 [A] [B] [C] [D]')
        ),
        div({ className: 'options-list' },
          (question.options || []).map((opt) => {
            const isSelected = userAnswer === opt.key;
            const isStandard = hasRevealedSolution && effectiveAnswer === opt.key;
            const isWrongPick = hasRevealedSolution && isSelected && !isStandard;

            let optionClass = 'option-item';
            if (isSelected) optionClass += ' selected';
            if (isStandard) optionClass += ' is-standard-option';
            if (isWrongPick) optionClass += ' is-wrong-pick';

            const optImages = (Array.isArray(opt.images) ? opt.images : (opt.image ? [{ localPath: opt.image }] : []))
              .filter(asset => asset && (!asset.type || asset.type === 'stem'))
              .map(asset => normalizeAssetUrl(asset.localPath || asset.local_path || asset.sourceUrl || asset.source_url))
              .filter(Boolean);

            return button({
              key: opt.key,
              className: optionClass,
              onClick: (e) => {
                if (e && e.target && e.target.closest && (
                  e.target.closest('.image-thumbnail-container') ||
                  e.target.closest('.stem-image-thumb') ||
                  e.target.closest('.img-zoom-hint') ||
                  e.target.tagName === 'IMG'
                )) {
                  return;
                }
                onAnswerChange(opt.key);
              }
            },
              span({ className: `option-key ${isSelected ? 'selected' : ''}` }, opt.key),
              span({ className: 'option-text' }, opt.text),
              optImages.map((optImgSrc, imageIndex) => div({
                key: imageIndex,
                className: 'image-thumbnail-container option-image-container',
                onClick: (e) => {
                  e.stopPropagation();
                  setModalImage(optImgSrc);
                }
              },
                img({
                  src: optImgSrc,
                  alt: `选项 ${opt.key} 附图`,
                  className: 'stem-image-thumb option-image-thumb'
                }),
                span({ className: 'img-zoom-hint' }, '🔍 点击放大附图')
              )),
              isStandard && span({ className: 'option-badge-standard' }, '标准答案'),
              isWrongPick && span({ className: 'option-badge-wrong' }, '你的选择')
            );
          })
        )
      ),

      // Instant Feedback Box (Practice & Memorize Modes)
      hasRevealedSolution && div({ className: 'instant-feedback-box' },
        // Feedback summary banner
        !isMemorizeMode && div({ className: `feedback-banner ${isUserCorrect ? 'correct' : 'wrong'}` },
          span({ className: 'feedback-icon' }, isUserCorrect ? '✓' : '✕'),
          span({ className: 'feedback-text' },
            isUserCorrect
              ? '回答正确！'
              : `回答错误！标准答案是【${effectiveAnswer}】`
          )
        ),

        // Official Explanation
        solution.analysis && div({ className: 'instant-analysis-content' },
          h4({ className: 'analysis-title' }, '💡 试题解析：'),
          p({ className: 'analysis-text' }, solution.analysis)
        ),

        // Solution Code Blocks
        solution.solutionCodeBlocks && solution.solutionCodeBlocks.length > 0 && div({ className: 'solution-code-blocks' },
          solution.solutionCodeBlocks.map((scb, sIdx) =>
            React.createElement(CodeBlock, {
              key: sIdx,
              code: scb.code,
              language: scb.language || 'c',
              title: `参考解答代码 ${sIdx + 1}`
            })
          )
        ),

        // Solution Images
        solution.solutionImages && solution.solutionImages.length > 0 && div({ className: 'solution-images-section' },
          solution.solutionImages.map((sImg, sIdx) => {
            const solSrc = normalizeAssetUrl(sImg.localPath || sImg.sourceUrl);
            return div({ key: sIdx, className: 'image-thumbnail-container' },
              img({
                src: solSrc,
                alt: `解析附图 ${sIdx + 1}`,
                className: 'stem-image-thumb',
                onClick: () => setModalImage(solSrc)
              }),
              span({
                className: 'img-zoom-hint',
                onClick: () => setModalImage(solSrc)
              }, '🔍 点击放大查看解析附图')
            );
          })
        )
      ),

      // Bottom Navigation Controls
      div({ className: 'card-footer-nav' },
        button({
          className: 'btn-nav prev',
          disabled: !hasPrev,
          onClick: onPrev
        }, '← 上一题'),
        span({ className: 'nav-current-info' },
          isMemorizeMode
            ? (effectiveAnswer ? `标准答案：${effectiveAnswer}` : '背诵记忆中')
            : (userAnswer ? `当前已选：${userAnswer}` : '尚未作答')
        ),
        button({
          className: 'btn-nav next',
          disabled: !hasNext,
          onClick: onNext
        }, '下一题 →')
      ),

      // Image Zoom Modal
      React.createElement(ImageModal, {
        isOpen: !!modalImage,
        src: modalImage,
        onClose: () => setModalImage(null)
      })
    );
  }

  return ObjectiveQuestion;
});
