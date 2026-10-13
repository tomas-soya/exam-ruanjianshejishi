/**
 * CaseQuestion Component
 * Renders sanitized case analysis question with shared problem stem,
 * diagrams, code blocks, and independent subquestion answer inputs.
 *
 * Supports 3 Delivery Modes (AC-A2):
 * - exam: strict answer isolation (never accesses or renders solutions/rubrics)
 * - practice: explicit "本题检查" button to reveal reference solution and rubrics without per-keystroke API calls
 * - memorize: immediate upfront reveal of reference answers and solution diagrams
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
    root.CaseQuestion = factory(
      root.React,
      root.DOM,
      root.CodeBlock,
      root.ImageModal
    );
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM, CodeBlock, ImageModal) {
  'use strict';

  const { div, span, button, p, textarea, h3, h4, img, strong } = DOM;
  const { useState } = React;

  function normalizeAssetUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
    if (!url.startsWith('/')) return '/' + url;
    return url;
  }

  function CaseQuestion({
    question,
    currentIndex,
    totalQuestions,
    userAnswer, // Record<string, string> or string
    onAnswerChange,
    isFlagged,
    onToggleFlag,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
    practiceMode = 'exam',
    solution = null,
    onCheckQuestion = null,
    isChecking = false,
    onOpenChat
  }) {
    const [modalImage, setModalImage] = useState(null);
    const [activeSubTab, setActiveSubTab] = useState(1);

    if (!question) return null;

    const isMemorizeMode = practiceMode === 'memorize';
    const isPracticeMode = practiceMode === 'practice';
    const hasRevealedSolution = (isMemorizeMode || solution) && Boolean(solution);

    // Stem code blocks and images only for sanitized question presentation
    const stemCodeBlocks = (question.codeBlocks || []).filter(cb => !cb.type || cb.type === 'stem');
    const stemImages = (question.images || []).filter(img => !img.type || img.type === 'stem');

    const numberedProblems = Array.from(String(question.sharedStem || '').matchAll(/【问题\s*([0-9０-９]+)】/g));
    const inferredCount = numberedProblems.length || 1;
    const subQuestions = question.subQuestions && question.subQuestions.length
      ? question.subQuestions
      : Array.from({ length: inferredCount }, (_, idx) => ({ id: `sub${idx + 1}`, title: `【问题 ${idx + 1}】`, stem: '' }));
    const visibleSubTab = Math.min(activeSubTab, subQuestions.length);

    const currentAnswers = typeof userAnswer === 'object' && userAnswer !== null
      ? userAnswer
      : { sub1: typeof userAnswer === 'string' ? userAnswer : '' };

    const handleSubAnswerChange = (subKey, text) => {
      const updated = {
        ...currentAnswers,
        [subKey]: text
      };
      onAnswerChange(updated);
    };

    const answeredSubsCount = Object.values(currentAnswers).filter(val => val && String(val).trim().length > 0).length;
    const isElective = totalQuestions === 6 && (currentIndex === 4 || currentIndex === 5);

    return div({ className: `question-card case-card mode-${practiceMode}` },
      // Header
      div({ className: 'card-header' },
        div({ className: 'question-meta' },
          span({ className: 'question-index-tag' }, `案例分析 第 ${currentIndex + 1} / ${totalQuestions} 题`),
          span({ className: 'subject-type-badge case' }, '下午应用技术'),
          isElective && span({
            className: 'elective-badge',
            style: { backgroundColor: '#feebc8', color: '#c05621', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }
          }, currentIndex === 4 ? '【选做题 · 试题五（二选一）】' : '【选做题 · 试题六（二选一）】'),
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
              title: question.caseTitle || `案例试题 ${currentIndex + 1}`,
              chapter: question.chapter
            }),
            title: '针对当前案例背景与设问向 AI 助教提问'
          }, '🤖 问AI助教'),
          button({
            className: `btn-flag ${isFlagged ? 'flagged' : ''}`,
            onClick: onToggleFlag,
            title: isFlagged ? '取消标记' : '标记该题稍后复查'
          }, isFlagged ? '🚩 已标记' : '⚐ 标记本题')
        )
      ),

      // Elective notice banner
      p({ className: 'question-public-id' }, `题号：${question.id}`),
      isElective && div({
        className: 'elective-prompt-banner',
        style: { margin: '8px 0', padding: '10px 14px', backgroundColor: '#fffaf0', borderLeft: '4px solid #dd6b20', borderRadius: '4px', fontSize: '13px', color: '#7b341e' }
      },
        strong(null, '📌 选做题规则说明：'),
        span(null, '试题五与试题六为二选一选做题（15分）。两题均支持完整作答与保存，交卷时将按您的选做计入总分（卷面有效总分75分）。若两题均作答，按软考考场规范默认计试题五。')
      ),

      // Case Title
      question.caseTitle && div({ className: 'case-title-box' },
        h3({ className: 'case-title-text' }, question.caseTitle)
      ),

      // Shared Problem Stem
      div({ className: 'question-stem-section shared-stem' },
        div({ className: 'stem-label' }, '【试题背景与说明】'),
        p({ className: 'question-stem-text' }, question.sharedStem)
      ),

      // Code blocks
      stemCodeBlocks.length > 0 && div({ className: 'question-code-blocks' },
        stemCodeBlocks.map((cb, idx) =>
          React.createElement(CodeBlock, {
            key: idx,
            code: cb.code,
            language: cb.language || 'c',
            title: `案例源码与接口说明 ${idx + 1}`
          })
        )
      ),

      // Images
      stemImages.length > 0 && div({ className: 'question-images-section' },
        stemImages.map((imgAsset, idx) => {
          const imgSrc = normalizeAssetUrl(imgAsset.localPath || imgAsset.sourceUrl);
          return div({ key: idx, className: 'image-thumbnail-container' },
            img({
              src: imgSrc,
              alt: `案例设计图 ${idx + 1}`,
              className: 'stem-image-thumb',
              onClick: () => setModalImage(imgSrc)
            }),
            span({
              className: 'img-zoom-hint',
              onClick: () => setModalImage(imgSrc)
            }, '🔍 点击放大查看设计图')
          );
        })
      ),

      // Subquestions Tabs & Inputs (Only if not in pure memorize mode, or allowed to type draft)
      div({ className: 'case-subquestions-container' },
        div({ className: 'subquestions-header' },
          h4({ className: 'subquestions-title' }, '【案例子问解答区】'),
          span({ className: 'subquestions-stat' }, `已作答：${answeredSubsCount} / ${subQuestions.length} 个子问`)
        ),

        // Subquestion Tab Headers
        div({ className: 'subquestions-tab-nav' },
          subQuestions.map((sub, idx) => {
            const hasAnswer = (currentAnswers[sub.id] || '').trim().length > 0;
            return button({
              key: sub.id,
              className: `subquestion-tab-btn ${visibleSubTab === idx + 1 ? 'active' : ''} ${hasAnswer ? 'answered' : ''}`,
              onClick: () => setActiveSubTab(idx + 1)
            },
              span({ className: 'tab-title' }, `问题 ${idx + 1}`),
              hasAnswer && span({ className: 'tab-check' }, '✓')
            );
          })
        ),

        // Subquestion Active Input Body
        subQuestions.map((sub, idx) => {
          if (visibleSubTab !== idx + 1) return null;
          const textVal = currentAnswers[sub.id] || '';
          const subCodeBlocks = (sub.codeBlocks || sub.code_blocks || []).filter(cb => !cb.type || cb.type === 'stem');
          const subImages = (sub.images || []).filter(img => !img.type || img.type === 'stem');
          return div({ key: sub.id, className: 'subquestion-active-panel' },
            div({ className: 'sub-title-bar' },
              span({ className: 'sub-title' }, sub.title),
              span({ className: 'sub-word-count' }, `当前字数：${textVal.length} 字`)
            ),
            sub.stem && p({ className: 'subquestion-stem', style: { whiteSpace: 'pre-wrap' } }, sub.stem),
            subCodeBlocks.length > 0 && div({ className: 'subquestion-code-blocks' },
              subCodeBlocks.map((cb, cIdx) =>
                React.createElement(CodeBlock, {
                  key: cIdx,
                  code: cb.code || cb.content,
                  language: cb.language || 'c',
                  title: `${sub.title} 代码片段 ${cIdx + 1}`
                })
              )
            ),
            subImages.length > 0 && div({ className: 'subquestion-images-section' },
              subImages.map((imgAsset, iIdx) => {
                const imgSrc = normalizeAssetUrl(imgAsset.localPath || imgAsset.local_path || imgAsset.sourceUrl || imgAsset.source_url);
                return div({ key: iIdx, className: 'image-thumbnail-container' },
                  img({
                    src: imgSrc,
                    alt: `${sub.title} 附图 ${iIdx + 1}`,
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
            textarea({
              className: 'subquestion-textarea',
              rows: 7,
              placeholder: `请输入针对${sub.title}的详细作答内容（支持多行文本与代码草稿，自动实时保存）...`,
              value: textVal,
              onChange: (e) => handleSubAnswerChange(sub.id, e.target.value)
            })
          );
        })
      ),

      // Explicit "Check Question" Button in Practice Mode
      isPracticeMode && div({ className: 'case-check-action-bar' },
        button({
          className: 'btn-check-case-action',
          onClick: onCheckQuestion,
          disabled: isChecking
        }, isChecking ? '正在核对案例参考答案...' : (hasRevealedSolution ? '🔄 重新核对案例参考答案' : '🔍 本题检查（查看参考解答与评分要点）'))
      ),

      // Revealed Reference Solution & Rubrics (Practice after check or Memorize mode)
      hasRevealedSolution && div({ className: 'case-solution-revealed-panel' },
        div({ className: 'solution-panel-header' },
          h4({ className: 'solution-title' }, '💡 案例分析参考解答与解析：'),
          span({ className: 'solution-badge' }, isMemorizeMode ? '记忆速记' : '参考核对')
        ),

        solution.analysis && div({ className: 'solution-text-box' },
          p({ className: 'solution-analysis-text' }, solution.analysis)
        ),

        // Solution Code Blocks
        solution.solutionCodeBlocks && solution.solutionCodeBlocks.length > 0 && div({ className: 'solution-code-blocks' },
          solution.solutionCodeBlocks.map((scb, sIdx) =>
            React.createElement(CodeBlock, {
              key: sIdx,
              code: scb.code,
              language: scb.language || 'c',
              title: `案例参考代码实现 ${sIdx + 1}`
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
                alt: `参考答案附图 ${sIdx + 1}`,
                className: 'stem-image-thumb',
                onClick: () => setModalImage(solSrc)
              }),
              span({
                className: 'img-zoom-hint',
                onClick: () => setModalImage(solSrc)
              }, '🔍 点击放大查看参考答案附图')
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
          answeredSubsCount > 0 ? `已填写 ${answeredSubsCount} 个子问` : '尚未作答'
        ),
        button({
          className: 'btn-nav next',
          disabled: !hasNext,
          onClick: onNext
        }, '下一题 →')
      ),

      // Diagram Zoom Modal
      React.createElement(ImageModal, {
        isOpen: !!modalImage,
        src: modalImage,
        onClose: () => setModalImage(null)
      })
    );
  }

  return CaseQuestion;
});
