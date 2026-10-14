/**
 * ReportView Component
 * Renders post-exam session report, score breakdown, wrong question cards,
 * correct vs user answer comparison, full explanations, and material anchors.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('react'),
      require('../utils/dom'),
      require('./CodeBlock'),
      require('./ImageModal'),
      require('./MaterialModal')
    );
  } else {
    root.ReportView = factory(
      root.React,
      root.DOM,
      root.CodeBlock,
      root.ImageModal,
      root.MaterialModal
    );
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM, CodeBlock, ImageModal, MaterialModal) {
  'use strict';

  const { div, span, button, h2, h3, h4, p, strong, input, textarea, label, img } = DOM;
  const { useState } = React;

  function normalizeAssetUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
    if (!url.startsWith('/')) return '/' + url;
    return url;
  }

  function ReportView({
    report,
    onBackToHome,
    onRetestWrong,
    onToggleMastered,
    onOpenMaterial,
    onOverrideCaseScore,
    onRegradeSession,
    onOpenChat
  }) {
    const [filterMode, setFilterMode] = useState('all'); // 'all' | 'wrong' | 'correct' | 'case' | 'unanswered'
    const [modalImage, setModalImage] = useState(null);
    const [openOverrideId, setOpenOverrideId] = useState(null);
    const [overrideForms, setOverrideForms] = useState({});
    const [isRegrading, setIsRegrading] = useState(false);
    const [regradeMessage, setRegradeMessage] = useState('');
    const handleRegrade = async () => {
      setIsRegrading(true);
      setRegradeMessage('');
      try {
        await onRegradeSession();
        setRegradeMessage('评分已更新，复习资料将在后台同步。');
      } catch (err) {
        setRegradeMessage(err.code === 'CASE_SCORING_UNAVAILABLE'
          ? 'LLM 暂不可用，未进行评分。答卷已保留，请恢复连接后重试。'
          : `重新评分失败：${err.message || '请稍后重试'}`);
      } finally {
        setIsRegrading(false);
      }
    };

    const handleToggleOverride = (questionId, item) => {
      if (openOverrideId === questionId) {
        setOpenOverrideId(null);
        return;
      }
      setOpenOverrideId(questionId);
      setOverrideForms(prev => {
        const existing = prev[questionId];
        if (existing && !existing.successMsg) {
          return prev;
        }
        const hasHumanOverride = item.caseReview && item.caseReview.humanOverridePoints !== null && item.caseReview.humanOverridePoints !== undefined;
        const initialPoints = hasHumanOverride
          ? item.caseReview.humanOverridePoints
          : (item.score !== undefined ? item.score : '');
        const initialNotes = (item.caseReview && item.caseReview.humanNotes) || '';
        return {
          ...prev,
          [questionId]: {
            points: String(initialPoints),
            notes: initialNotes,
            error: null,
            isSubmitting: false,
            successMsg: null
          }
        };
      });
    };

    const handleFieldChange = (questionId, field, value) => {
      setOverrideForms(prev => ({
        ...prev,
        [questionId]: {
          ...(prev[questionId] || {}),
          [field]: value,
          error: null,
          successMsg: null
        }
      }));
    };

    const handleCancelOverride = (questionId) => {
      setOpenOverrideId(null);
      setOverrideForms(prev => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    };

    const handleSaveOverride = async (questionId, maxScore) => {
      const form = overrideForms[questionId] || {};
      const rawPoints = form.points;

      if (rawPoints === '' || rawPoints === null || rawPoints === undefined) {
        setOverrideForms(prev => ({
          ...prev,
          [questionId]: {
            ...form,
            error: `覆核得分不能为空，请输入 0 到 ${maxScore} 之间的数值`
          }
        }));
        return;
      }

      const num = Number(rawPoints);
      if (!Number.isFinite(num) || isNaN(num)) {
        setOverrideForms(prev => ({
          ...prev,
          [questionId]: {
            ...form,
            error: '覆核得分必须为有效数值'
          }
        }));
        return;
      }

      if (num < 0 || num > maxScore) {
        setOverrideForms(prev => ({
          ...prev,
          [questionId]: {
            ...form,
            error: `覆核得分必须在 0 到 ${maxScore} 分之间，不能为负数或超界（当前输入：${num}）`
          }
        }));
        return;
      }

      setOverrideForms(prev => ({
        ...prev,
        [questionId]: {
          ...form,
          isSubmitting: true,
          error: null,
          successMsg: null
        }
      }));

      try {
        if (typeof onOverrideCaseScore === 'function') {
          await onOverrideCaseScore(questionId, {
            points: num,
            notes: form.notes || ''
          });
        }
        setOverrideForms(prev => ({
          ...prev,
          [questionId]: {
            ...form,
            isSubmitting: false,
            error: null,
            successMsg: '✅ 覆核得分与批注已成功持久化至本地数据库！'
          }
        }));
        setTimeout(() => {
          setOpenOverrideId(prev => (prev === questionId ? null : prev));
        }, 1500);
      } catch (err) {
        setOverrideForms(prev => ({
          ...prev,
          [questionId]: {
            ...form,
            isSubmitting: false,
            error: `保存失败（${err.message || '网络连接失败'}），未保存至服务端，请检查后重试`
          }
        }));
      }
    };

    if (!report) {
      return div({ className: 'report-empty-state' },
        h3(null, '暂无成绩报告'),
        button({ className: 'btn-primary', onClick: onBackToHome }, '返回首页')
      );
    }

    const {
      title,
      score,
      maxScore,
      accuracy,
      totalQuestions,
      answeredCount,
      correctCount,
      wrongCount,
      submittedAt,
      questions = [],
      unansweredCount: rawUnanswered,
      answeredMaxScore: rawAnsweredMaxScore,
      answersRevealed,
      assistanceUsed,
      practiceMode = 'exam',
      paperId = ''
    } = report;

    const hasAssistedOrRevealed = answersRevealed || assistanceUsed || practiceMode === 'practice';
    const hasPendingScoring = (report.pendingScoringCount || 0) > 0;

    const unansweredCount = rawUnanswered !== undefined ? rawUnanswered : (totalQuestions - answeredCount);
    const answeredMaxScore = rawAnsweredMaxScore || (totalQuestions > 0 ? (answeredCount) : maxScore);

    const isCaseReport = questions.some(item => item.question && item.question.subject === 'case') || Boolean(paperId && String(paperId).includes('case'));
    const isStandardFullExam = maxScore === 75;
    const passThreshold = isStandardFullExam ? 45 : Math.round((answeredMaxScore || maxScore) * 0.6);
    const isPassed = score >= passThreshold;
    const accuracyPercent = Math.min(100, Math.max(0, Math.round(
      typeof accuracy === 'number'
        ? accuracy * 100
        : (isCaseReport
            ? (maxScore > 0 ? (score / maxScore) * 100 : 0)
            : (answeredCount > 0 ? (correctCount / answeredCount) * 100 : 0))
    )));

    // Filter questions
    const filteredQuestions = questions.filter(item => {
      const isElectiveUnselected = item.status === 'unselected' || item.isElectiveUnselected;
      const isUnans = item.status === 'unanswered' || (item.isCorrect === null && (!item.userAnswer || (typeof item.userAnswer === 'object' && !Object.values(item.userAnswer).some(v => v && String(v).trim().length > 0))));
      if (filterMode === 'unanswered') return isUnans && !isElectiveUnselected;
      if (filterMode === 'wrong') return item.isCorrect === false && !isElectiveUnselected;
      if (filterMode === 'correct') return item.isCorrect === true && !isElectiveUnselected;
      if (filterMode === 'case') return item.question.subject === 'case';
      return true;
    });

    return div({ className: 'report-view-container' },
      hasPendingScoring && p({ className: 'scoring-pending-notice', role: 'status' },
        `有 ${report.pendingScoringCount} 道已作答案例题待评分。LLM 暂不可用，未生成总分，不计入错题或复习资料。答案已保留。`),
      regradeMessage && p({ role: 'status' }, regradeMessage),
      // Answers Revealed / AI Assistance Used Warning Banner (AC-A2, AC-Q2)
      hasAssistedOrRevealed && div({ className: 'answers-revealed-warning-banner assisted-banner' },
        span({ className: 'warn-icon' }, '⚠️'),
        span({ className: 'warn-text' },
          assistanceUsed
            ? '注意：本次模考在答题过程中曾退出严格模考并启用 AI 助教辅导，成绩已被永久标记为【辅助练习】，仅供温习自测，不可作为严格模考成绩。'
            : '注意：本次练习在作答过程中曾切换至【练习模式】或【记忆模式】提前查看过题目解析与参考答案，本次成绩已被永久标记，仅供自学参考。'
        ),
        span({ className: 'badge-assisted-practice' }, '【辅助练习】')
      ),

      // 1. Overall Score Summary Banner
      div({ className: `score-summary-banner ${isPassed ? 'passed' : 'unpassed'}` },
        div({ className: 'banner-main' },
          div({ className: 'banner-title-group' },
            div({ className: 'title-with-badge-row' },
              h2({ className: 'report-title' }, title || '答题成绩与错题报告'),
              hasAssistedOrRevealed && span({ className: 'badge-assisted-tag' }, '【辅助练习】')
            ),
            !isStandardFullExam && totalQuestions < 75 && span({ className: 'paper-scope-notice', style: { display: 'inline-block', fontSize: '12px', color: '#2b6cb0', backgroundColor: '#ebf8ff', padding: '2px 8px', borderRadius: '4px', marginTop: '4px' } }, `【收录题目练习】本卷收录 ${totalQuestions} 道试题（满分 ${maxScore} 分），按实际收录题量判分与统计`),
            span({ className: 'submit-time' }, `交卷时间：${submittedAt ? new Date(submittedAt).toLocaleString('zh-CN') : '刚刚'}`)
          ),
          div({ className: 'score-display' },
            div({ className: 'score-number-group' },
              span({ className: 'score-val' }, hasPendingScoring ? '待评分' : score),
              span({ className: 'score-max' }, unansweredCount > 0 ? ` / ${maxScore} 分 (已答总分 ${answeredMaxScore} 分)` : ` / ${maxScore} 分`)
            ),
            !hasPendingScoring && div({ className: `pass-tag ${isPassed ? 'pass' : 'fail'}` },
              isStandardFullExam
                ? (isPassed ? '🎉 成绩及格 (≥45分)' : '⚡ 尚未及格 (<45分)')
                : (isPassed ? `🎉 练习达标 (≥${passThreshold}分，得分率≥60%)` : `⚡ 尚未达标 (<${passThreshold}分，得分率<60%)`)
            )
          )
        ),

        div({ className: 'banner-stats-grid' },
          div({ className: 'stat-box' },
            span({ className: 'stat-label' }, '做题正确率'),
            span({ className: 'stat-value highlight' }, hasPendingScoring ? '待评分' : `${accuracyPercent}%`),
            span({ className: 'stat-sub' }, `基于已作答 ${answeredCount} 题`)
          ),
          div({ className: 'stat-box' },
            span({ className: 'stat-label' }, '做对试题'),
            span({ className: 'stat-value success' }, `${correctCount} 题`)
          ),
          div({ className: 'stat-box' },
            span({ className: 'stat-label' }, '做错试题'),
            span({ className: 'stat-value danger' }, `${wrongCount} 题`)
          ),
          div({ className: 'stat-box' },
            span({ className: 'stat-label' }, '未作答试题'),
            span({ className: 'stat-value neutral' }, `${unansweredCount} 题`),
            span({ className: 'stat-sub' }, '不计入错题与扣分')
          ),
          div({ className: 'stat-box' },
            span({ className: 'stat-label' }, '已作答 / 总题数'),
            span({ className: 'stat-value' }, `${answeredCount} / ${totalQuestions}`)
          )
        )
      ),

      // 2. Report Controls & Filters
      div({ className: 'report-controls-bar' },
        div({ className: 'report-filter-buttons' },
          button({
            className: `btn-filter-tag ${filterMode === 'all' ? 'active' : ''}`,
            onClick: () => setFilterMode('all')
          }, `全部试题 (${questions.length})`),
          button({
            className: `btn-filter-tag danger ${filterMode === 'wrong' ? 'active' : ''}`,
            onClick: () => setFilterMode('wrong')
          }, `仅看错题 (${wrongCount})`),
          button({
            className: `btn-filter-tag success ${filterMode === 'correct' ? 'active' : ''}`,
            onClick: () => setFilterMode('correct')
          }, `仅看做对 (${correctCount})`),
          unansweredCount > 0 && button({
            className: `btn-filter-tag neutral ${filterMode === 'unanswered' ? 'active' : ''}`,
            onClick: () => setFilterMode('unanswered')
          }, `未作答 (${unansweredCount})`),
          button({
            className: `btn-filter-tag ${filterMode === 'case' ? 'active' : ''}`,
            onClick: () => setFilterMode('case')
          }, '案例分析题')
        ),

        div({ className: 'report-actions' },
          report.canRegrade && onRegradeSession && button({
            type: 'button', className: 'btn-primary', onClick: handleRegrade, disabled: isRegrading
          }, isRegrading ? '正在评分…' : '重新进行 LLM 评分'),
          onOpenChat && button({
            type: 'button',
            className: 'btn-ask-report-chat',
            onClick: () => onOpenChat({
              type: 'report',
              targetId: report.sessionId || 'current-report',
              title: `模考分析：${title || '成绩单'}（${hasPendingScoring ? '待评分' : `得分：${score}分`}）`,
              sessionId: report.sessionId
            }),
            title: '使用 AI 助教诊断考情与薄弱考点'
          }, '🤖 错题与考情 AI 诊断'),
          wrongCount > 0 && onRetestWrong && button({
            className: 'btn-retest-wrong',
            onClick: onRetestWrong
          }, '针对错题重新特训'),
          button({
            className: 'btn-back-home',
            onClick: onBackToHome
          }, '返回试卷列表')
        )
      ),

      // 3. Question Detail Cards List
      div({ className: 'report-questions-list' },
        filteredQuestions.map((item, idx) => {
          const q = item.question;
          const isCorrect = item.isCorrect;
          const userAnswer = item.userAnswer;
          const effectiveAnswer = item.effectiveAnswer;
          const isElectiveUnselected = item.status === 'unselected' || item.isElectiveUnselected;
          const pendingScoring = item.pendingScoring;
          const isUnanswered = (item.status === 'unanswered' || (isCorrect === null && (!userAnswer || (typeof userAnswer === 'object' && !Object.values(userAnswer).some(v => v && String(v).trim().length > 0))))) && !isElectiveUnselected;

          return div({
            key: q.id || idx,
            className: `report-question-card ${isElectiveUnselected ? 'card-unselected' : isUnanswered ? 'card-unanswered' : (isCorrect === true ? 'card-correct' : isCorrect === false ? 'card-wrong' : 'card-case')}`
          },
            // Card Header
            div({ className: 'report-card-header' },
              div({ className: 'header-left' },
                span({ className: 'report-q-num' }, `第 ${idx + 1} 题`),
                span({ className: `badge-result ${isElectiveUnselected ? 'unselected' : isUnanswered ? 'unanswered' : (isCorrect === true ? 'correct' : isCorrect === false ? 'wrong' : 'case')}` },
                  isElectiveUnselected ? '⚪ 选做题二选一（未选）' : pendingScoring ? '⏳ 待评分' : isUnanswered ? '⏳ 未作答（不扣分）' : (isCorrect === true ? '✓ 作答正确' : isCorrect === false ? '✕ 作答错误' : '✎ 案例解答')
                ),
                span({ className: 'report-score-badge' },
                  isElectiveUnselected ? `不计分 / 15 分（未选题，不计入总分与错题）` : pendingScoring ? '得分：待评分' : isUnanswered ? `得分：0 / ${item.maxScore} 分（未作答不评分）` : `得分：${item.score !== null && item.score !== undefined ? item.score : 0} / ${item.maxScore} 分`
                ),
                item.caseReview && item.caseReview.humanOverridePoints !== null && item.caseReview.humanOverridePoints !== undefined && span({ className: 'badge-overridden' }, '已教师覆核'),
                q.chapter && span({ className: 'chapter-badge' }, q.chapter)
              ),

              // Header Right Actions (AI Assistant + Material Anchor)
              div({ className: 'header-card-actions' },
                onOpenChat && button({
                  type: 'button',
                  className: 'btn-ask-report-q',
                  onClick: () => onOpenChat({
                    type: 'question',
                    targetId: q.id,
                    title: `试题解析：第 ${idx + 1} 题（${q.chapter || '错题分析'}）`,
                    chapter: q.chapter,
                    sessionId: report.sessionId
                  }),
                  title: '向 AI 助教寻求本题思路与考点辨析'
                }, '🤖 问AI助教'),
                item.materialAnchor && button({
                  className: 'btn-open-material-anchor',
                  onClick: () => onOpenMaterial(item.materialAnchor)
                }, '📖 查看对应考点精讲 →')
              )
            ),

            // Elective Unselected notice banner
            isElectiveUnselected && div({ className: 'elective-unselected-notice', style: { padding: '8px 12px', backgroundColor: '#f7fafc', borderLeft: '4px solid #a0aec0', margin: '8px 0', fontSize: '13px', color: '#4a5568', borderRadius: '4px' } },
              '【选做题规则说明】本题为下午应用技术科目选做题（试题五 / 试题六 二选一）。系统已完整保留您的答题与参考内容，按选做规则未计入总分，不影响满分 75 分计算与及格判定，亦不作为错题计入复习队列。'
            ),

            // Question Stem
            div({ className: 'report-card-stem' },
              p(null, q.subject === 'case' ? q.sharedStem : q.questionStem)
            ),

            // Stem Code blocks
            q.codeBlocks && q.codeBlocks.length > 0 && div({ className: 'report-code-blocks' },
              q.codeBlocks.map((cb, cIdx) =>
                React.createElement(CodeBlock, {
                  key: cIdx,
                  code: typeof cb === 'string' ? cb : (cb.code || ''),
                  language: (typeof cb === 'object' && cb.language) ? cb.language : 'c'
                })
              )
            ),

            // Stem Images (AC-A4)
            q.images && q.images.length > 0 && div({ className: 'report-images-section' },
              q.images.filter(im => {
                if (!im) return false;
                if (im.type && im.type !== 'stem') return false;
                const url = String(im.sourceUrl || im.source_url || '').toLowerCase();
                const local = String(im.localPath || im.local_path || '').toLowerCase();
                if (url.includes('avatars.githubusercontent.com') || url.includes('/avatar') || local.includes('/avatar')) return false;
                return true;
              }).map((imgAsset, imgIdx) => {
                const src = normalizeAssetUrl(imgAsset.localPath || imgAsset.sourceUrl);
                return div({ key: imgIdx, className: 'image-thumbnail-container' },
                  img({
                    src,
                    alt: `试题附图 ${imgIdx + 1}`,
                    className: 'stem-image-thumb',
                    onClick: () => setModalImage(src)
                  }),
                  span({
                    className: 'img-zoom-hint',
                    onClick: () => setModalImage(src)
                  }, '🔍 点击放大查看附图')
                );
              })
            ),

            // Options Comparison for Objective Questions
            q.subject === 'objective' && div({ className: 'report-options-comparison' },
              div({ className: 'answer-comparison-box' },
                div({ className: 'answer-item' },
                  span({ className: 'ans-label' }, '考生作答：'),
                  span({ className: `ans-value ${isCorrect ? 'correct' : 'wrong'}` },
                    userAnswer ? String(userAnswer) : '（未作答）'
                  )
                ),
                div({ className: 'answer-item' },
                  span({ className: 'ans-label' }, '标准答案：'),
                  span({ className: 'ans-value correct' }, effectiveAnswer || '—')
                )
              ),

              // Options list with highlights
              q.options && div({ className: 'report-options-list' },
                q.options.map(opt => {
                  const isUserPick = userAnswer === opt.key;
                  const isStandard = effectiveAnswer === opt.key;
                  let optClass = 'report-option-item';
                  if (isStandard) optClass += ' is-standard';
                  if (isUserPick && !isStandard) optClass += ' is-user-wrong';

                  return div({ key: opt.key, className: optClass },
                    span({ className: 'opt-key' }, opt.key),
                    span({ className: 'opt-text' }, opt.text),
                    isStandard && span({ className: 'tag-standard' }, '标准答案'),
                    isUserPick && !isStandard && span({ className: 'tag-user-wrong' }, '你的选择')
                  );
                })
              )
            ),

            // Case Subquestions Answers for Case Questions
            q.subject === 'case' && div({ className: 'report-case-subquestions' },
              h4({ className: 'case-sub-title' }, '考生各子问答卷与得分说明：'),
              typeof userAnswer === 'object' && userAnswer !== null ?
                Object.entries(userAnswer).map(([subKey, text]) =>
                  div({ key: subKey, className: 'case-sub-answer-box' },
                    span({ className: 'sub-key-name' }, subKey.toUpperCase()),
                    p({ className: 'sub-text' }, text || '（未作答）')
                  )
                ) :
                p({ className: 'sub-text' }, typeof userAnswer === 'string' && userAnswer ? userAnswer : '（未作答）')
            ),

            // AI / System Evaluation Feedback Box
            q.subject === 'case' && pendingScoring && p({ className: 'ai-eval-box' }, item.scoringMessage),
            q.subject === 'case' && !pendingScoring && div({ className: 'ai-eval-box' },
              div({ className: 'ai-eval-header' },
                span({ className: 'ai-badge' }, (item.caseReview && item.caseReview.evaluatorType === 'llm') ? '🤖 AI智能评分' : '⚙️ 规则引擎评分'),
                span({ className: 'ai-score-label' }, `AI/系统原始得分：${(item.caseReview && item.caseReview.points !== undefined) ? item.caseReview.points : item.score} / ${item.maxScore} 分`),
                item.caseReview && item.caseReview.needsHumanReview && span({ className: 'needs-review-badge' }, '⚠️ 系统建议人工复核')
              ),
              div({ className: 'ai-feedback-text' },
                strong(null, '智能判分评语：'),
                span(null, (item.caseReview && item.caseReview.feedback) || '暂无详细AI评语')
              ),
              item.caseReview && item.caseReview.breakdown && item.caseReview.breakdown.length > 0 && div({ className: 'ai-sub-scores-list' },
                item.caseReview.breakdown.map((bd, bIdx) =>
                  div({ key: bIdx, className: 'ai-sub-score-item' },
                    span({ className: 'bd-sub-name' }, bd.subQuestionTitle || `子问 ${bIdx + 1}`),
                    span({ className: 'bd-sub-pts' }, `${bd.points} / ${bd.maxPoints} 分`),
                    bd.feedback && span({ className: 'bd-sub-feed' }, `（${bd.feedback}）`)
                  )
                )
              )
            ),

            // Human Review Status Box (if already overridden)
            q.subject === 'case' && item.caseReview && item.caseReview.humanOverridePoints !== null && item.caseReview.humanOverridePoints !== undefined && div({ className: 'human-review-status-box' },
              div({ className: 'human-status-header' },
                span({ className: 'human-override-badge' }, '🧑‍🏫 教师人工覆核已生效'),
                span({ className: 'human-score-label' }, `覆核最终得分：${item.caseReview.humanOverridePoints} / ${item.maxScore} 分`)
              ),
              div({ className: 'human-notes-text' },
                strong(null, '教师批注与评分说明：'),
                span(null, item.caseReview.humanNotes || '（无批注）')
              )
            ),

            // Teacher Review Interactive Form Panel
            q.subject === 'case' && item.caseReview && !pendingScoring && (() => {
              const isEditing = openOverrideId === q.id;
              const hasOverride = item.caseReview && item.caseReview.humanOverridePoints !== null && item.caseReview.humanOverridePoints !== undefined;
              const form = overrideForms[q.id] || {
                points: hasOverride ? String(item.caseReview.humanOverridePoints) : String(item.score !== undefined ? item.score : ''),
                notes: (item.caseReview && item.caseReview.humanNotes) || '',
                error: null,
                isSubmitting: false,
                successMsg: null
              };

              return div({ className: 'teacher-review-panel' },
                div({ className: 'review-panel-top' },
                  span({ className: 'panel-hint-text' }, '教师可对案例题组总分与批注进行人工覆核：'),
                  button({
                    type: 'button',
                    className: `btn-toggle-override ${hasOverride ? 'overridden' : ''}`,
                    onClick: () => handleToggleOverride(q.id, item)
                  }, isEditing ? '收起覆核面板' : (hasOverride ? '✏️ 修改人工覆核成绩' : '🧑‍🏫 人工覆核评分'))
                ),

                isEditing && div({ className: 'human-override-form' },
                  div({ className: 'override-form-group' },
                    label({ className: 'override-label', htmlFor: `score-input-${q.id}` }, `案例题组覆核得分 (0 - ${item.maxScore} 分)：`),
                    input({
                      id: `score-input-${q.id}`,
                      name: 'overridePoints',
                      type: 'number',
                      className: 'input-override-score',
                      min: 0,
                      max: item.maxScore,
                      step: 0.5,
                      placeholder: `请输入 0 至 ${item.maxScore} 的数值`,
                      value: form.points !== undefined ? form.points : '',
                      disabled: form.isSubmitting,
                      onChange: (e) => handleFieldChange(q.id, 'points', e.target.value)
                    })
                  ),

                  div({ className: 'override-form-group' },
                    label({ className: 'override-label', htmlFor: `notes-input-${q.id}` }, '教师批注 / 评分理由：'),
                    textarea({
                      id: `notes-input-${q.id}`,
                      name: 'overrideNotes',
                      className: 'input-override-notes',
                      rows: 3,
                      placeholder: '请输入教师批注与判分理由（可说明各子问具体给分情况）...',
                      value: form.notes !== undefined ? form.notes : '',
                      disabled: form.isSubmitting,
                      onChange: (e) => handleFieldChange(q.id, 'notes', e.target.value)
                    })
                  ),

                  form.error && div({ className: 'override-error-msg' },
                    span({ className: 'error-icon' }, '⚠️ '),
                    span({ className: 'error-text' }, form.error)
                  ),

                  form.successMsg && div({ className: 'override-success-msg' },
                    span({ className: 'success-icon' }, '✅ '),
                    span({ className: 'success-text' }, form.successMsg)
                  ),

                  div({ className: 'override-form-actions' },
                    button({
                      type: 'button',
                      className: 'btn-save-override',
                      disabled: form.isSubmitting,
                      onClick: () => handleSaveOverride(q.id, item.maxScore)
                    }, form.isSubmitting ? '保存中...' : (form.error ? '重试保存' : '保存覆核')),

                    button({
                      type: 'button',
                      className: 'btn-cancel-override',
                      disabled: form.isSubmitting,
                      onClick: () => handleCancelOverride(q.id)
                    }, '取消')
                  )
                )
              );
            })(),

            // Official Explanation / Analysis
            (item.analysis || item.solution_and_analysis) && div({ className: 'report-explanation-box' },
              h4({ className: 'explanation-title' }, '💡 试题深度解析：'),
              div({ className: 'explanation-content' },
                p(null, item.analysis || item.solution_and_analysis)
              )
            ),

            // Solution code / diagrams (now safe to display post-submission)
            item.solutionCodeBlocks && item.solutionCodeBlocks.length > 0 && div({ className: 'solution-code-blocks' },
              item.solutionCodeBlocks.map((scb, sIdx) =>
                React.createElement(CodeBlock, {
                  key: sIdx,
                  code: scb.code,
                  language: scb.language || 'c',
                  title: '参考解答代码'
                })
              )
            ),

            // Solution Images (AC-A4)
            item.solutionImages && item.solutionImages.length > 0 && div({ className: 'report-solution-images' },
              item.solutionImages.map((sImg, sIdx) => {
                const sSrc = normalizeAssetUrl(sImg.localPath || sImg.sourceUrl);
                return div({ key: sIdx, className: 'image-thumbnail-container' },
                  img({
                    src: sSrc,
                    alt: `参考答案附图 ${sIdx + 1}`,
                    className: 'stem-image-thumb',
                    onClick: () => setModalImage(sSrc)
                  }),
                  span({
                    className: 'img-zoom-hint',
                    onClick: () => setModalImage(sSrc)
                  }, '🔍 点击放大查看参考答案附图')
                );
              })
            ),

            // Wrong question mastered toggle
            isCorrect === false && onToggleMastered && div({ className: 'report-card-footer' },
              button({
                className: 'btn-toggle-mastered',
                onClick: () => onToggleMastered(q.id)
              }, '标记为已掌握（移出高频错题库）')
            )
          );
        })
      ),

      // Diagram Zoom Modal
      React.createElement(ImageModal, {
        isOpen: !!modalImage,
        src: modalImage,
        onClose: () => setModalImage(null)
      })
    );
  }

  return ReportView;
});
