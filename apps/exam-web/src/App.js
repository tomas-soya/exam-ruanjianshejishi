/**
 * Main Application Component (App.js)
 * Coordinates Views, Exam Session Lifecycle, Debounced Auto-Save,
 * Resumption from Local Storage/Backend, Answer Sheet, Post-Exam Reports,
 * Material Anchors, 3 Delivery Modes, and History Management.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('react'),
      require('./utils/dom'),
      require('./api/client'),
      require('./components/Header'),
      require('./components/PaperList'),
      require('./components/ChapterList'),
      require('./components/ObjectiveQuestion'),
      require('./components/CaseQuestion'),
      require('./components/AnswerSheet'),
      require('./components/ReportView'),
      require('./components/WrongQuestionsView'),
      require('./components/ReviewQueueView'),
      require('./components/MaterialModal'),
      require('./components/HistoryView'),
      require('./components/PersonalMaterialsView'),
      require('./components/ChatAssistant'),
      require('./components/SettingsModal')
    );
  } else {
    root.App = factory(
      root.React,
      root.DOM,
      root.ExamApiClient,
      root.Header,
      root.PaperList,
      root.ChapterList,
      root.ObjectiveQuestion,
      root.CaseQuestion,
      root.AnswerSheet,
      root.ReportView,
      root.WrongQuestionsView,
      root.ReviewQueueView,
      root.MaterialModal,
      root.HistoryView,
      root.PersonalMaterialsView,
      root.ChatAssistant,
      root.SettingsModal
    );
  }
})(typeof self !== 'undefined' ? self : this, function (
  React,
  DOM,
  ExamApiClient,
  Header,
  PaperList,
  ChapterList,
  ObjectiveQuestion,
  CaseQuestion,
  AnswerSheet,
  ReportView,
  WrongQuestionsView,
  ReviewQueueView,
  MaterialModal,
  HistoryView,
  PersonalMaterialsView,
  ChatAssistant,
  SettingsModal
) {
  'use strict';

  const { div, main, p, button, h2, h3, span } = DOM;
  const { useState, useEffect, useRef, useCallback } = React;

  function App({ apiClient, initialSessionId }) {
    const client = useRef(apiClient || new ExamApiClient()).current;

    // View Navigation: 'papers' | 'chapters' | 'wrong_questions' | 'review_queue' | 'history' | 'exam' | 'report'
    const [activeTab, setActiveTab] = useState('papers');

    // Data Catalogs
    const [papers, setPapers] = useState([]);
    const [chapters, setChapters] = useState([]);
    const [wrongQuestions, setWrongQuestions] = useState([]);
    const [reviewQueue, setReviewQueue] = useState([]);
    const [personalMaterials, setPersonalMaterials] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(false);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);

    // Active Session State
    const [session, setSession] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState({});
    const [flags, setFlags] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isSubmittingRef = useRef(false);

    // Delivery Modes (AC-A2): 'exam' | 'practice' | 'memorize'
    const [practiceMode, setPracticeMode] = useState('exam');
    const [solutions, setSolutions] = useState({}); // questionId -> QuestionSolution
    const [isCheckingQuestion, setIsCheckingQuestion] = useState(false);
    const [showModeSwitchWarningModal, setShowModeSwitchWarningModal] = useState(false);
    const [pendingTargetMode, setPendingTargetMode] = useState(null);

    // Auto-save & Status
    const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved' | 'offline'
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const saveTimerRef = useRef(null);

    // Timer
    const [timerSeconds, setTimerSeconds] = useState(0);
    const timerIntervalRef = useRef(null);
    const isStartingChapterPracticeRef = useRef(false);

    // Post-Exam Report
    const [report, setReport] = useState(null);

    // Material Modal Anchor Viewer
    const [materialModal, setMaterialModal] = useState({
      isOpen: false,
      anchor: null,
      content: '',
      isLoading: false
    });

    // AI Chat Assistant (AC-Q1..Q5)
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatContext, setChatContext] = useState({
      type: 'general',
      title: '软考全科跨章节综合答疑'
    });

    // System Settings & DB Migration Modal
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // 1. Initial Data Loading & Resumption
    useEffect(() => {
      loadCatalogs();

      // Check if session can be resumed from storage or prop
      const savedSessionId = initialSessionId || (typeof localStorage !== 'undefined' ? localStorage.getItem('ruankao_active_session_id') : null);
      if (savedSessionId) {
        resumeSession(savedSessionId);
      }
    }, []);

    const loadCatalogs = async () => {
      setIsLoadingCatalogs(true);
      try {
        const [papersData, chaptersData] = await Promise.all([
          client.listPapers().catch(() => []),
          client.listChapters().catch(() => [])
        ]);
        setPapers(papersData || []);
        setChapters(chaptersData || []);
      } catch (e) {
        console.error('Failed to load catalogs:', e);
      } finally {
        setIsLoadingCatalogs(false);
      }
    };

    const loadSessions = async () => {
      setIsLoadingSessions(true);
      try {
        const res = await client.listSessions();
        const list = Array.isArray(res) ? res : (res && res.data ? res.data : []);
        // 未作答的记录不加入答题历史
        const answeredList = list.filter(s => (s.answeredCount || 0) > 0);
        setSessions(answeredList);
      } catch (e) {
        console.warn('Failed to load sessions:', e);
      } finally {
        setIsLoadingSessions(false);
      }
    };

    const loadPersonalMaterials = async () => {
      setIsLoadingMaterials(true);
      try {
        const res = await client.listPersonalMaterials();
        const list = Array.isArray(res) ? res : (res && res.data ? res.data : []);
        setPersonalMaterials(list);
      } catch (e) {
        console.warn('Failed to load personal materials:', e);
      } finally {
        setIsLoadingMaterials(false);
      }
    };

    // Load tab-specific data on tab activation
    useEffect(() => {
      if (activeTab === 'papers') {
        loadCatalogs();
      } else if (activeTab === 'wrong_questions') {
        client.listWrongQuestions().then(data => setWrongQuestions(data || [])).catch(() => {});
      } else if (activeTab === 'review_queue') {
        client.getReviewQueue().then(data => setReviewQueue(data || [])).catch(() => {});
      } else if (activeTab === 'materials') {
        loadPersonalMaterials();
      } else if (activeTab === 'history') {
        loadSessions();
      }
    }, [activeTab]);

    // Timer logic during active exam
    useEffect(() => {
      if (activeTab === 'exam' && session && session.status === 'in_progress') {
        timerIntervalRef.current = setInterval(() => {
          setTimerSeconds(sec => sec + 1);
        }, 1000);
      } else {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      }
      return () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      };
    }, [activeTab, session]);

    // Position auto-save on currentIndex change (AC-A1)
    useEffect(() => {
      if (session && session.id && session.status === 'in_progress') {
        client.updateSessionState(session.id, { currentPosition: currentIndex }).catch(() => {});
      }
    }, [currentIndex, session]);

    // 2. Session Creation & Resumption
    const startNewSession = async ({ mode, paperId, chapter, subject, questionIds, title, targetPracticeMode = 'exam' }) => {
      try {
        setSaveStatus('saving');
        const sessionData = await client.createSession({
          mode,
          paperId,
          chapter,
          subject,
          questionIds,
          title,
          practiceMode: targetPracticeMode
        });

        let sessionQuestions = [];
        if (mode === 'paper' && paperId) {
          const paperDetail = await client.getPaper(paperId);
          sessionQuestions = paperDetail.questions || [];
        } else {
          // fetch session details
          const resumed = await client.getSession(sessionData.id);
          sessionQuestions = resumed.questions || [];
        }

        // If subject is explicitly provided, isolate by subject to prevent cross-class leakage (EMPTY-01, P1-W9-03)
        if (subject) {
          sessionQuestions = sessionQuestions.filter(q => q.subject === subject);
        }

        // Guard against zero-question empty session (EMPTY-03)
        if (mode === 'chapter' && sessionQuestions.length === 0) {
          alert(`【${chapter}】暂无可练试题，未建立空会话。`);
          setSaveStatus('saved');
          return;
        }

        setSession(sessionData);
        setQuestions(sessionQuestions);
        setCurrentIndex(0);
        setAnswers({});
        setFlags({});
        setSolutions({});
        setPracticeMode(targetPracticeMode);
        setTimerSeconds(0);
        setReport(null);
        setSaveStatus('saved');
        setActiveTab('exam');

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('ruankao_active_session_id', sessionData.id);
          if (subject) {
            localStorage.setItem(`ruankao_session_${sessionData.id}_subject`, subject);
          }
        }

        // If starting in memorize or practice mode, prefetch solutions
        if (targetPracticeMode === 'memorize' || targetPracticeMode === 'practice') {
          client.getSessionSolutions(sessionData.id).then(res => {
            if (res && res.solutions) {
              setSolutions(res.solutions);
              setSession(s => s ? ({ ...s, answersRevealed: true }) : s);
            }
          }).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to start session:', err);
        alert(`创建答题会话失败：${err.message}`);
      }
    };

    // 2.1 Start Chapter Practice from Personal Materials (EMPTY-01..04, P0-W9-01, P1-W9-02, P1-W9-03, P2-W9-04)
    const handleStartChapterPractice = async (chapterName, subject) => {
      if (isStartingChapterPracticeRef.current) return;
      isStartingChapterPracticeRef.current = true;
      try {
        // Check question availability in catalog to avoid empty session (EMPTY-03)
        let chapterList = chapters;
        if (!chapterList || chapterList.length === 0) {
          try {
            chapterList = await client.listChapters();
            setChapters(chapterList || []);
          } catch (e) {
            chapterList = [];
          }
        }

        const match = (chapterList || []).find(c => {
          const name = typeof c === 'string' ? c : c.chapter;
          return name === chapterName || (name && (name.startsWith(chapterName) || chapterName.startsWith(name)));
        });

        let questionCount = 0;
        if (match && typeof match === 'object') {
          if (subject === 'case') {
            questionCount = match.caseCount || 0;
          } else if (subject === 'objective') {
            questionCount = match.objectiveCount || 0;
          } else {
            questionCount = (match.objectiveCount || 0) + (match.caseCount || 0);
          }
        }

        if (!match || questionCount === 0) {
          alert(`【${chapterName}】当前题库中暂无可练试题，未建立空会话。`);
          return;
        }

        // Preserve existing in-progress session draft (EMPTY-03, P2-W9-04)
        if (session && session.id && session.status === 'in_progress') {
          try {
            const currentQ = questions[currentIndex];
            if (currentQ && answers[currentQ.id] !== undefined) {
              await client.saveAnswerDraft(session.id, currentQ.id, currentQ.subject, answers[currentQ.id]);
            }
            await client.updateSessionState(session.id, {
              currentPosition: currentIndex,
              practiceMode
            });
          } catch (err) {
            console.warn('Auto-save in-progress session draft before chapter practice failed:', err);
            alert(`保存当前会话草稿失败：${err.message || '网络或存储异常'}，已中止切换以保护已有答题进度。`);
            return;
          }
        }

        const targetChapter = (match && (match.chapter || (typeof match === 'string' ? match : null))) || chapterName;
        const titlePrefix = subject === 'case' ? '【案例专题】' : '【章节特训】';
        await startNewSession({
          mode: 'chapter',
          chapter: targetChapter,
          subject,
          title: `${titlePrefix}${chapterName}`,
          targetPracticeMode: practiceMode || 'exam'
        });
      } finally {
        isStartingChapterPracticeRef.current = false;
      }
    };

    const resumeSession = async (sessionId) => {
      try {
        setSaveStatus('saving');
        const resumed = await client.getSession(sessionId);
        if (!resumed || !resumed.session) return;

        let resumedSubject = null;
        if (typeof localStorage !== 'undefined') {
          resumedSubject = localStorage.getItem(`ruankao_session_${sessionId}_subject`);
        }
        if (!resumedSubject && resumed.session && resumed.session.title) {
          if (resumed.session.title.includes('案例')) {
            resumedSubject = 'case';
          } else if (resumed.session.title.includes('章节')) {
            resumedSubject = 'objective';
          }
        }

        let sessionQuestions = resumed.questions || [];
        if (resumedSubject && sessionQuestions.length > 0) {
          sessionQuestions = sessionQuestions.filter(q => q.subject === resumedSubject);
        }

        setSession(resumed.session);
        setQuestions(sessionQuestions);
        const restoredMode = resumed.session.practiceMode || 'exam';
        setPracticeMode(restoredMode);

        // Restore position (AC-A1)
        const savedPos = typeof resumed.session.currentPosition === 'number' ? resumed.session.currentPosition : 0;
        setCurrentIndex(Math.max(0, Math.min(savedPos, (sessionQuestions.length || 1) - 1)));

        // Restore answers from server or localStorage backup
        let restoredAnswers = resumed.answers || {};
        if (typeof localStorage !== 'undefined') {
          const localDrafts = localStorage.getItem(`ruankao_session_${sessionId}_drafts`);
          if (localDrafts) {
            try {
              const parsed = JSON.parse(localDrafts);
              restoredAnswers = { ...restoredAnswers, ...parsed };
            } catch (e) {}
          }
        }

        setAnswers(restoredAnswers);
        setSaveStatus('saved');

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('ruankao_active_session_id', sessionId);
        }

        if (resumed.session.status === 'submitted') {
          // Already submitted, load report
          const rpt = await client.getSessionReport(sessionId);
          setReport(rpt);
          setActiveTab('report');
        } else {
          setActiveTab('exam');

          // If session is in memorize or practice mode or solutions were revealed, prefetch solutions
          if (restoredMode === 'memorize' || restoredMode === 'practice' || resumed.session.answersRevealed) {
            client.getSessionSolutions(sessionId).then(res => {
              if (res && res.solutions) {
                setSolutions(res.solutions);
                setSession(s => s ? ({ ...s, answersRevealed: true }) : s);
              }
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('Failed to resume session:', err);
      }
    };

    // 3. Debounced Auto-Save Mechanism
    const handleAnswerChange = useCallback((questionId, newAnswer) => {
      setAnswers(prev => {
        const next = { ...prev, [questionId]: newAnswer };

        // Save local backup immediately
        if (session && typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(`ruankao_session_${session.id}_drafts`, JSON.stringify(next));
          } catch (e) {}
        }
        return next;
      });

      setSaveStatus('unsaved');

      // Debounce server save by 450ms
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!session) return;
        setSaveStatus('saving');
        try {
          const currentQ = questions.find(q => q.id === questionId);
          const qType = currentQ ? currentQ.subject : 'objective';
          await client.saveAnswerDraft(session.id, questionId, qType, newAnswer);
          setSaveStatus('saved');
          const now = new Date();
          setLastSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`);
        } catch (err) {
          console.warn('Auto-save failed:', err);
          setSaveStatus('offline');
        }
      }, 450);

      // In practice mode for objective questions, automatically fetch feedback upon selection (AC-A2)
      if (practiceMode === 'practice' && session) {
        const currentQ = questions.find(q => q.id === questionId);
        if (currentQ && currentQ.subject === 'objective') {
          client.checkQuestion(session.id, questionId, newAnswer).then(sol => {
            if (sol) {
              setSolutions(prev => ({ ...prev, [questionId]: sol }));
              setSession(s => s ? ({ ...s, answersRevealed: true }) : s);
            }
          }).catch(err => {
            console.warn('Practice check error:', err);
          });
        }
      }
    }, [session, questions, client, practiceMode]);

    const handleToggleFlag = (questionId) => {
      setFlags(prev => ({
        ...prev,
        [questionId]: !prev[questionId]
      }));
    };

    // 4. Delivery Mode Switching (AC-A2)
    const handleRequestSwitchMode = (targetMode) => {
      if (targetMode === practiceMode) return;

      // If switching from practice/memorize back to exam mode AND answers were revealed
      const answersWereRevealed = session?.answersRevealed || (solutions && Object.keys(solutions).length > 0);
      if (targetMode === 'exam' && answersWereRevealed) {
        setPendingTargetMode('exam');
        setShowModeSwitchWarningModal(true);
        return;
      }

      applyModeSwitch(targetMode);
    };

    const applyModeSwitch = async (newMode) => {
      setPracticeMode(newMode);
      if (session) {
        setSession(prev => ({ ...prev, practiceMode: newMode }));
        try {
          await client.updateSessionState(session.id, { practiceMode: newMode });
        } catch (e) {
          console.warn('Failed to persist practiceMode:', e);
        }

        if (newMode === 'memorize' || newMode === 'practice') {
          // Preload solutions in memorize or practice mode
          client.getSessionSolutions(session.id).then(res => {
            if (res && res.solutions) {
              setSolutions(prev => ({ ...prev, ...res.solutions }));
              setSession(s => s ? ({ ...s, answersRevealed: true }) : s);
            }
          }).catch(() => {});
        }
      }
    };

    const handleConfirmSwitchToExam = () => {
      setShowModeSwitchWarningModal(false);
      applyModeSwitch('exam');
    };

    // 4.1 Case Question Practice Check Button (AC-A2)
    const handleCheckCaseQuestion = async () => {
      const currentQ = questions[currentIndex];
      if (!session || !currentQ) return;
      setIsCheckingQuestion(true);
      try {
        const userAns = answers[currentQ.id] || {};
        const sol = await client.checkQuestion(session.id, currentQ.id, userAns);
        if (sol) {
          setSolutions(prev => ({ ...prev, [currentQ.id]: sol }));
          setSession(s => s ? ({ ...s, answersRevealed: true }) : s);
        }
      } catch (err) {
        alert(`核对试题失败：${err.message}`);
      } finally {
        setIsCheckingQuestion(false);
      }
    };

    // 4.2 Safe Save & Exit Draft (AC-A1)
    const handleSaveAndExit = async () => {
      if (!session) return;
      setSaveStatus('saving');
      try {
        // Immediately persist current answers if any unsaved
        const currentQ = questions[currentIndex];
        if (currentQ && answers[currentQ.id] !== undefined) {
          await client.saveAnswerDraft(session.id, currentQ.id, currentQ.subject, answers[currentQ.id]);
        }
        await client.updateSessionState(session.id, {
          currentPosition: currentIndex,
          practiceMode
        });
        setSaveStatus('saved');
      } catch (e) {
        console.warn('Failed to save state on exit:', e);
      }

      setActiveTab('history');
      loadSessions();
    };

    // 4.3 Delete Exam Session (AC-3, AC-4)
    const handleDeleteSession = async (sessionId) => {
      try {
        await client.deleteSession(sessionId);
        // Clear active session if it was deleted
        if (session && session.id === sessionId) {
          setSession(null);
          setAnswers({});
          setQuestions([]);
        }
        // Clear report if currently viewing report of deleted session
        if (report && report.sessionId === sessionId) {
          setReport(null);
          setActiveTab('history');
        }
        await loadSessions();
      } catch (err) {
        console.warn('Delete session failed:', err);
        throw err;
      }
    };

    // 5. Submit Exam Session
    const handleSubmitExam = async () => {
      if (!session || isSubmitting || isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        const reportData = await client.submitSession(session.id);
        setReport(reportData);
        setActiveTab('report');
        loadCatalogs();
        if (typeof localStorage !== 'undefined') {
          // Retain session id so page refresh on report view successfully restores session report
          localStorage.setItem('ruankao_active_session_id', session.id);
        }
      } catch (err) {
        const displayMsg = err.userFriendlyMessage || err.message || '网络或服务端异常';
        alert(`交卷未完成：${displayMsg}\n\n已为您保留全部答题记录与草稿，未产生虚假成绩。您可以检查网络后重新点击交卷。`);
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    };

    const handleBackToHome = () => {
      setActiveTab('papers');
      loadCatalogs();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('ruankao_active_session_id');
      }
    };

    // 5.1 View Report for Submitted Session
    const handleViewReport = async (sessionId) => {
      try {
        const rpt = await client.getSessionReport(sessionId);
        setReport(rpt);
        setActiveTab('report');
      } catch (err) {
        alert(`载入模考报告失败：${err.message}`);
      }
    };

    const handleRegradeSession = async () => {
      if (!report?.sessionId) return;
      const updated = await client.regradeSession(report.sessionId);
      setReport(updated);
      const [wrongData, queueData] = await Promise.all([
        client.listWrongQuestions().catch(() => null), client.getReviewQueue().catch(() => null)
      ]);
      if (wrongData) setWrongQuestions(wrongData);
      if (queueData) setReviewQueue(queueData);
    };

    // 5.2 Human Review Override for Case Questions
    const handleOverrideCaseScore = async (questionId, { points, notes }) => {
      if (!report || !report.sessionId) return;
      await client.overrideCaseScore(report.sessionId, questionId, { points, notes });
      const updatedReport = await client.getSessionReport(report.sessionId);
      setReport(updatedReport);

      // Refresh wrong questions & review queue in background
      try {
        const [wrongData, queueData] = await Promise.all([
          client.listWrongQuestions().catch(() => null),
          client.getReviewQueue().catch(() => null)
        ]);
        if (wrongData) setWrongQuestions(wrongData);
        if (queueData) setReviewQueue(queueData);
      } catch (e) {}
    };

    // 6. Open Revision Material Anchor
    const handleOpenMaterial = async (materialAnchor) => {
      if (!materialAnchor) return;
      setMaterialModal({
        isOpen: true,
        anchor: materialAnchor,
        content: '',
        isLoading: true
      });

      try {
        const content = await client.getMaterialDoc(materialAnchor.relativeDocPath);
        setMaterialModal(prev => ({
          ...prev,
          content: typeof content === 'string' ? content : (content && content.markdown) || '',
          error: null,
          isLoading: false
        }));
      } catch (err) {
        setMaterialModal(prev => ({
          ...prev,
          content: '',
          error: `无法载入考点资料文档（${err.message || '后端未运行或资料未就绪'}）`,
          isLoading: false
        }));
      }
    };

    const handleToggleMastered = async (questionId, mastered = true) => {
      try {
        await client.toggleWrongQuestionMastered(questionId, mastered);
        // Refresh wrong questions list
        const updated = await client.listWrongQuestions();
        setWrongQuestions(updated || []);
      } catch (e) {
        console.error('Failed to toggle mastered:', e);
      }
    };

    // 7. AI Chat Assistant Handlers (AC-Q1..Q5)
    const handleOpenChat = (customContext) => {
      if (customContext) {
        setChatContext({
          ...customContext,
          sessionId: session ? session.id : undefined
        });
      } else {
        const currentQ = questions[currentIndex];
        if (activeTab === 'exam' && currentQ) {
          setChatContext({
            type: 'question',
            targetId: currentQ.id,
            title: currentQ.caseTitle || `试题 ${currentIndex + 1}（${currentQ.chapter || '试题答疑'}）`,
            chapter: currentQ.chapter,
            paperId: session ? session.paperId : undefined,
            sessionId: session ? session.id : undefined
          });
        } else if (activeTab === 'report' && report) {
          setChatContext({
            type: 'report',
            targetId: report.sessionId || 'current-report',
            title: `模考分析：${report.title || '成绩单'}（${report.score == null ? '待评分' : `得分：${report.score}分`}）`,
            sessionId: report.sessionId
          });
        } else if (activeTab === 'materials') {
          setChatContext({
            type: 'material',
            targetId: 'materials',
            title: '21 章节个人弱项考点复习讲义',
            sessionId: session ? session.id : undefined
          });
        } else {
          setChatContext({
            type: 'general',
            title: '软考全科跨章节综合答疑',
            sessionId: session ? session.id : undefined
          });
        }
      }
      setIsChatOpen(true);
    };

    const handleToggleChat = () => {
      if (isChatOpen) {
        setIsChatOpen(false);
      } else {
        handleOpenChat();
      }
    };

    const handleExitExamModeSuccess = (res) => {
      if (!res) return;
      setPracticeMode('practice');
      setSession(prev => prev ? ({
        ...prev,
        practiceMode: 'practice',
        answersRevealed: true,
        assistanceUsed: true
      }) : prev);
    };

    const handleOpenMaterialAnchor = (anchor) => {
      if (!anchor) return;
      if (typeof window !== 'undefined' && anchor.heading) {
        window.location.hash = `#${encodeURIComponent(anchor.heading)}`;
      }
      handleOpenMaterial({
        chapter: anchor.chapter,
        relativeDocPath: anchor.docPath,
        anchorHeading: anchor.heading,
        topic: anchor.heading
      });
    };

    const currentQuestion = questions[currentIndex] || null;

    return div({ className: 'ruankao-app-root' },
      // Global Header
      React.createElement(Header, {
        activeTab,
        onTabChange: setActiveTab,
        saveStatus,
        lastSavedAt,
        timerSeconds: activeTab === 'exam' ? timerSeconds : null,
        activeSession: session,
        onBackToSession: () => setActiveTab('exam'),
        onBackToHome: handleBackToHome,
        isChatOpen,
        onToggleChat: handleToggleChat,
        onOpenSettings: () => setIsSettingsOpen(true)
      }),

      // Main View Container
      main({ className: 'app-main-content' },
        // View 1: Papers
        activeTab === 'papers' && React.createElement(PaperList, {
          papers,
          isLoading: isLoadingCatalogs,
          onSelectPaper: (paperId, subject) => startNewSession({
            mode: 'paper',
            paperId,
            title: papers.find(p => p.id === paperId)?.title || '历年真题模考'
          })
        }),

        // View 2: Chapters
        activeTab === 'chapters' && React.createElement(ChapterList, {
          chapters,
          isLoading: isLoadingCatalogs,
          onSelectChapter: (chapterName) => startNewSession({
            mode: 'chapter',
            chapter: chapterName,
            title: `【章节特训】${chapterName}`
          })
        }),

        // View 3: Wrong Questions
        activeTab === 'wrong_questions' && React.createElement(WrongQuestionsView, {
          wrongQuestions,
          chapters,
          papers,
          onToggleMastered: handleToggleMastered,
          onStartWrongPractice: (questionIds, paperInfo) => startNewSession({
            mode: 'wrong_questions',
            paperId: paperInfo?.id || null,
            subject: paperInfo?.subject || null,
            questionIds,
            title: paperInfo ? `【错题再练】${paperInfo.title || paperInfo.id} (${questionIds.length}题)` : `【错题再练】精选 ${questionIds.length} 题特训`
          })
        }),

        // View 4: Spaced Repetition Queue
        activeTab === 'review_queue' && React.createElement(ReviewQueueView, {
          reviewQueue,
          onStartReviewPractice: (questionIds) => startNewSession({
            mode: 'wrong_questions',
            questionIds,
            title: `【记忆周期】今日到期 ${questionIds.length} 题智能复习`
          })
        }),

        // View 5: History View (AC-A1)
        activeTab === 'history' && React.createElement(HistoryView, {
          sessions,
          isLoading: isLoadingSessions,
          onResumeSession: (sessionId) => resumeSession(sessionId),
          onViewReport: (sessionId) => handleViewReport(sessionId),
          onRefresh: loadSessions,
          onDeleteSession: (sessionId) => handleDeleteSession(sessionId)
        }),

        // View 6: Personal Materials (AC-B1..B5)
        activeTab === 'materials' && React.createElement(PersonalMaterialsView, {
          apiClient: client,
          materials: personalMaterials,
          isLoading: isLoadingMaterials,
          onRefresh: loadPersonalMaterials,
          onStartChapterPractice: (chapterName, subject) => handleStartChapterPractice(chapterName, subject),
          onOpenChat: handleOpenChat
        }),

        // View 7: Active Exam Practice
        activeTab === 'exam' && div({ className: 'exam-workspace-layout' },
          div({ className: 'exam-main-panel' },
            // Workspace Header Bar with Mode Switcher & Save & Exit (AC-A1, AC-A2)
            div({ className: 'workspace-top-bar' },
              div({ className: 'mode-switcher-group' },
                span({ className: 'switcher-label' }, '做题模式：'),
                button({
                  type: 'button',
                  className: `btn-mode-switch ${practiceMode === 'exam' ? 'active' : ''}`,
                  onClick: () => handleRequestSwitchMode('exam')
                }, '📝 考试模式'),
                button({
                  type: 'button',
                  className: `btn-mode-switch ${practiceMode === 'practice' ? 'active' : ''}`,
                  onClick: () => handleRequestSwitchMode('practice')
                }, '💡 练习模式'),
                button({
                  type: 'button',
                  className: `btn-mode-switch ${practiceMode === 'memorize' ? 'active' : ''}`,
                  onClick: () => handleRequestSwitchMode('memorize')
                }, '📖 记忆模式')
              ),

              div({ className: 'workspace-quick-actions' },
                button({
                  type: 'button',
                  className: 'btn-save-and-exit-header',
                  onClick: handleSaveAndExit,
                  title: '保存答题草稿并返回答题历史列表'
                }, '💾 保存并退出')
              )
            ),

            // Question Content
            currentQuestion && (
              currentQuestion.subject === 'case'
                ? React.createElement(CaseQuestion, {
                    question: currentQuestion,
                    currentIndex,
                    totalQuestions: questions.length,
                    userAnswer: answers[currentQuestion.id] || {},
                    onAnswerChange: (ans) => handleAnswerChange(currentQuestion.id, ans),
                    isFlagged: !!flags[currentQuestion.id],
                    onToggleFlag: () => handleToggleFlag(currentQuestion.id),
                    onNext: () => setCurrentIndex(i => Math.min(i + 1, questions.length - 1)),
                    onPrev: () => setCurrentIndex(i => Math.max(i - 1, 0)),
                    hasNext: currentIndex < questions.length - 1,
                    hasPrev: currentIndex > 0,
                    practiceMode,
                    solution: solutions[currentQuestion.id] || null,
                    onCheckQuestion: handleCheckCaseQuestion,
                    isChecking: isCheckingQuestion,
                    onOpenChat: handleOpenChat
                  })
                : React.createElement(ObjectiveQuestion, {
                    question: currentQuestion,
                    currentIndex,
                    totalQuestions: questions.length,
                    userAnswer: answers[currentQuestion.id] || '',
                    onAnswerChange: (ans) => handleAnswerChange(currentQuestion.id, ans),
                    isFlagged: !!flags[currentQuestion.id],
                    onToggleFlag: () => handleToggleFlag(currentQuestion.id),
                    onNext: () => setCurrentIndex(i => Math.min(i + 1, questions.length - 1)),
                    onPrev: () => setCurrentIndex(i => Math.max(i - 1, 0)),
                    hasNext: currentIndex < questions.length - 1,
                    hasPrev: currentIndex > 0,
                    practiceMode,
                    solution: solutions[currentQuestion.id] || null,
                    onOpenChat: handleOpenChat
                  })
            )
          ),

          div({ className: 'exam-sidebar-panel' },
            React.createElement(AnswerSheet, {
              questions,
              currentIndex,
              answers,
              flags,
              solutions,
              onJumpToQuestion: (idx) => setCurrentIndex(idx),
              onSubmitExam: handleSubmitExam,
              isSubmitting,
              onSaveAndExit: handleSaveAndExit,
              practiceMode
            })
          )
        ),

        // View 7: Post-Exam Report
        activeTab === 'report' && React.createElement(ReportView, {
          report,
          onRegradeSession: handleRegradeSession,
          onBackToHome: handleBackToHome,
          onRetestWrong: () => {
            if (!report) return;
            const wrongIds = report.questions.filter(q => q.isCorrect === false).map(q => q.question.id);
            if (wrongIds.length > 0) {
              startNewSession({
                mode: 'wrong_questions',
                questionIds: wrongIds,
                title: `【错题再练】${report.title || '本次模考'}`
              });
            }
          },
          onToggleMastered: handleToggleMastered,
          onOpenMaterial: handleOpenMaterial,
          onOverrideCaseScore: handleOverrideCaseScore,
          onOpenChat: handleOpenChat
        })
      ),

      // Material Anchor Markdown Modal
      React.createElement(MaterialModal, {
        isOpen: materialModal.isOpen,
        materialAnchor: materialModal.anchor,
        materialContent: materialModal.content,
        error: materialModal.error,
        isLoading: materialModal.isLoading,
        onClose: () => setMaterialModal(prev => ({ ...prev, isOpen: false })),
        onOpenChat: handleOpenChat
      }),

      // Mode Switch Confirmation Modal (AC-A2)
      showModeSwitchWarningModal && div({ className: 'submit-modal-backdrop' },
        div({ className: 'submit-modal-content mode-warning-modal' },
          h3({ className: 'submit-modal-title' }, '切回考试模式提醒'),
          p({ className: 'submit-modal-desc' },
            '您已在【练习模式】或【记忆模式】下查看过题目的标准答案或解析。'
          ),
          p({ className: 'submit-modal-note' },
            '现在切回【考试模式】后，当前会话仍将保留“已查看答案”的标记，最终交卷成绩仅供自测与温习参考。是否确认切回？'
          ),
          div({ className: 'submit-modal-actions' },
            button({
              className: 'btn-modal-cancel',
              onClick: () => setShowModeSwitchWarningModal(false)
            }, '保持当前模式'),
            button({
              className: 'btn-modal-confirm',
              onClick: handleConfirmSwitchToExam
            }, '确认切回考试模式')
          )
        )
      ),

      // Floating AI Assistant Launcher Button
      div({
        className: `floating-chat-trigger ${isChatOpen ? 'active' : ''}`,
        onClick: handleToggleChat,
        title: isChatOpen ? '收起 AI 助教' : '打开 AI 助教'
      },
        span({ className: 'floating-trigger-icon' }, '🤖'),
        span({ className: 'floating-trigger-text' }, isChatOpen ? '收起助教' : 'AI 助教')
      ),

      // AI Chat Assistant Drawer (AC-Q1..Q5)
      React.createElement(ChatAssistant, {
        isOpen: isChatOpen,
        onClose: () => setIsChatOpen(false),
        context: chatContext,
        apiClient: client,
        activeSession: session,
        onExitExamModeSuccess: handleExitExamModeSuccess,
        onOpenMaterialAnchor: handleOpenMaterialAnchor
      }),

      // System Settings & Database Migration Modal
      React.createElement(SettingsModal, {
        isOpen: isSettingsOpen,
        onClose: () => setIsSettingsOpen(false),
        apiClient: client,
        onDatabaseRestored: () => {
          loadCatalogs();
          loadSessions();
        }
      })
    );
  }

  return App;
});
