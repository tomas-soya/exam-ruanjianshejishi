/**
 * SettingsModal Component
 * Full-featured System Settings dialog:
 * 1. LLM API configuration (URL, API Key, Model Selection/Query, Timeout, Connection Test, Persistence)
 * 2. SQLite Database Backup & Cross-Device Migration (Path inspection, 1-click Export, Restore Import, Cold-copy guide)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.SettingsModal = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, h2, h3, h4, p, span, button, input, select, option, label, code, pre } = DOM;
  const { useState, useEffect } = React;

  const PRESET_ENDPOINTS = [
    { label: '本地 Gemini (127.0.0.1:8045)', url: 'http://127.0.0.1:8045/v1' },
    { label: 'OpenAI 官方', url: 'https://api.openai.com/v1' },
    { label: 'DeepSeek 官方', url: 'https://api.deepseek.com/v1' },
    { label: '硅基流动', url: 'https://api.siliconflow.cn/v1' }
  ];

  function SettingsModal({ isOpen, onClose, apiClient, onDatabaseRestored }) {
    const [activeTab, setActiveTab] = useState('llm'); // 'llm' | 'db'

    // LLM Config state
    const [endpoint, setEndpoint] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [timeoutSeconds, setTimeoutSeconds] = useState(30);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [maskedApiKey, setMaskedApiKey] = useState('');
    const [showKeyPlain, setShowKeyPlain] = useState(false);

    const [availableModels, setAvailableModels] = useState([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [modelQueryMsg, setModelQueryMsg] = useState('');

    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);

    // DB Manager state
    const [dbInfo, setDbInfo] = useState(null);
    const [isLoadingDbInfo, setIsLoadingDbInfo] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importMsg, setImportMsg] = useState(null);
    const [importError, setImportError] = useState(null);
    const [isGuideOpen, setIsGuideOpen] = useState(false);

    // Load initial settings on modal open
    useEffect(() => {
      let isMounted = true;

      // 1. Load LLM config
      if (apiClient?.getLlmConfig) {
        apiClient.getLlmConfig()
          .then(data => {
            if (!isMounted || !data) return;
            setEndpoint(data.endpoint || '');
            setModel(data.model || '');
            setTimeoutSeconds(Math.round((data.timeoutMs || 30000) / 1000));
            setHasApiKey(Boolean(data.hasApiKey));
            setMaskedApiKey(data.maskedApiKey || '');
          })
          .catch(() => {});
      }

      // 2. Load DB info
      if (apiClient?.getDatabaseInfo) {
        setIsLoadingDbInfo(true);
        apiClient.getDatabaseInfo()
          .then(info => {
            if (!isMounted) return;
            setDbInfo(info);
          })
          .catch(() => {})
          .finally(() => {
            if (isMounted) setIsLoadingDbInfo(false);
          });
      }

      return () => { isMounted = false; };
    }, [isOpen, apiClient]);

    // Handle Escape key and body scroll lock
    useEffect(() => {
      if (!isOpen) return;
      const handleKeyDown = (e) => {
        if (e.key === 'Escape' || e.keyCode === 27) {
          if (typeof onClose === 'function') {
            onClose();
          }
        }
      };
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.addEventListener('keydown', handleKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
          window.removeEventListener('keydown', handleKeyDown);
          document.body.style.overflow = prevOverflow;
        };
      }
    }, [isOpen, onClose]);

    // Test Connection
    const handleTestConnection = async () => {
      setIsTesting(true);
      setTestResult(null);
      try {
        const res = await apiClient.testLlmConnection({
          endpoint,
          apiKey: apiKey.trim() || undefined,
          model,
          timeoutMs: timeoutSeconds * 1000
        });
        setTestResult(res);
      } catch (err) {
        setTestResult({
          ok: false,
          error: err.message || '网络连接失败',
          message: '连接失败'
        });
      } finally {
        setIsTesting(false);
      }
    };

    // Query Models
    const handleFetchModels = async () => {
      setIsLoadingModels(true);
      setModelQueryMsg('');
      try {
        const models = await apiClient.listLlmModels({
          endpoint,
          apiKey: apiKey.trim() || undefined,
          timeoutMs: timeoutSeconds * 1000
        });
        setAvailableModels(models || []);
        if (models && models.length > 0) {
          setModelQueryMsg(`成功获取 ${models.length} 个模型`);
        } else {
          setModelQueryMsg('网关未返回模型列表，请手动输入模型名称');
        }
      } catch (err) {
        setModelQueryMsg(`查询失败: ${err.message || '无法获取'}`);
      } finally {
        setIsLoadingModels(false);
      }
    };

    // Save LLM Config
    const handleSaveConfig = async () => {
      setIsSaving(true);
      setSaveMessage(null);
      try {
        const updated = await apiClient.saveLlmConfig({
          endpoint,
          apiKey: apiKey.trim() || undefined,
          model,
          timeoutMs: timeoutSeconds * 1000
        });
        setHasApiKey(Boolean(updated.hasApiKey));
        setMaskedApiKey(updated.maskedApiKey || '');
        setApiKey(''); // clear plain input after save
        setSaveMessage('✓ 大模型配置已成功保存并立即生效！');
        setTimeout(() => setSaveMessage(null), 4000);
      } catch (err) {
        setSaveMessage(`保存失败: ${err.message || '未知错误'}`);
      } finally {
        setIsSaving(false);
      }
    };

    // Copy DB Path
    const handleCopyPath = () => {
      if (dbInfo && dbInfo.dbPath && navigator.clipboard) {
        navigator.clipboard.writeText(dbInfo.dbPath).then(() => {
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
        });
      }
    };

    // Export DB
    const handleExportDb = () => {
      if (apiClient?.exportDatabaseUrl) {
        const url = apiClient.exportDatabaseUrl();
        window.location.href = url;
      }
    };

    // Import DB
    const handleImportDb = async () => {
      if (!selectedFile) return;
      if (!window.confirm('【重要提醒】恢复备份将覆盖当前的做题记录。\n系统将自动生成一份本地 .bak 快照副本作为安全保障。\n确认继续导入吗？')) {
        return;
      }

      setIsImporting(true);
      setImportMsg(null);
      setImportError(null);
      try {
        const res = await apiClient.importDatabase(selectedFile);
        setImportMsg('✓ ' + (res.message || '学习历史已成功恢复！'));
        setSelectedFile(null);
        // Refresh db info
        if (apiClient.getDatabaseInfo) {
          const fresh = await apiClient.getDatabaseInfo();
          setDbInfo(fresh);
        }
        if (typeof onDatabaseRestored === 'function') {
          onDatabaseRestored();
        }
      } catch (err) {
        setImportError('导入失败: ' + (err.message || '未知错误'));
      } finally {
        setIsImporting(false);
      }
    };

    if (!isOpen) return null;

    return div({
      className: 'modal-overlay settings-modal-backdrop',
      onClick: onClose
    },
      div({
        className: 'settings-modal-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '系统设置与数据管理',
        onClick: e => e.stopPropagation()
      },
        // Header
        div({ className: 'settings-modal-header' },
          div({ className: 'settings-title-group' },
            span({ className: 'settings-icon' }, '⚙️'),
            h2({ className: 'settings-title' }, '系统设置与数据管理')
          ),
          button({ className: 'btn-close-modal', onClick: onClose, title: '关闭 (Esc)' }, '✕')
        ),

        // Tabs
        div({ className: 'settings-nav-tabs' },
          button({
            className: `settings-tab-btn ${activeTab === 'llm' ? 'active' : ''}`,
            onClick: () => setActiveTab('llm')
          }, '🤖 大模型 API 配置 (助教/判分/资料)'),
          button({
            className: `settings-tab-btn ${activeTab === 'db' ? 'active' : ''}`,
            onClick: () => setActiveTab('db')
          }, '💾 学习记录备份与跨设备迁移')
        ),

        // Tab Content
        div({ className: 'settings-modal-body' },
          activeTab === 'llm' && div({ className: 'settings-tab-pane' },
            div({ className: 'settings-scope-banner' },
              span({ className: 'banner-icon' }, 'ℹ️'),
              span({ className: 'banner-text' },
                '此处的 LLM 配置全局生效于：' +
                '① AI 助教答疑 (右下角四场景问答) ；' +
                '② 案例分析题智能评分与参考比对；' +
                '③ 21章个人薄弱考点资料动态精炼与艾宾浩斯排程。'
              )
            ),

            // Endpoint Input
            div({ className: 'form-group' },
              label({ className: 'form-label' }, 'API 接口地址 (URL)'),
              input({
                type: 'text',
                className: 'form-input',
                value: endpoint,
                placeholder: '填写你使用的 OpenAI 兼容接口地址',
                onChange: e => setEndpoint(e.target.value)
              }),
              div({ className: 'preset-tags' },
                span({ className: 'preset-label' }, '常用快捷填入:'),
                PRESET_ENDPOINTS.map(p =>
                  button({
                    key: p.label,
                    type: 'button',
                    className: 'btn-preset-tag',
                    onClick: () => setEndpoint(p.url)
                  }, p.label)
                )
              )
            ),

            // API Key Input
            div({ className: 'form-group' },
              div({ className: 'label-with-status' },
                label({ className: 'form-label' }, 'API 密钥 (API Key)'),
                hasApiKey && span({ className: 'key-badge-saved' }, `✓ 已保存密钥 (${maskedApiKey})`)
              ),
              div({ className: 'input-with-button' },
                input({
                  type: showKeyPlain ? 'text' : 'password',
                  className: 'form-input',
                  value: apiKey,
                  placeholder: hasApiKey ? '留空保持原有密钥不变；输入新密钥以替换' : '请输入 API Key (例如 sk-...)',
                  onChange: e => setApiKey(e.target.value)
                }),
                button({
                  type: 'button',
                  className: 'btn-secondary btn-icon-only',
                  onClick: () => setShowKeyPlain(!showKeyPlain),
                  title: showKeyPlain ? '隐藏明文' : '查看明文'
                }, showKeyPlain ? '🙈' : '👁️')
              )
            ),

            // Model Selection & Query
            div({ className: 'form-group' },
              div({ className: 'label-with-status' },
                label({ className: 'form-label' }, '模型名称 (Model)'),
                button({
                  type: 'button',
                  className: 'btn-text-action',
                  disabled: isLoadingModels,
                  onClick: handleFetchModels
                }, isLoadingModels ? '正在查询模型...' : '🔍 从网关查询可用模型')
              ),
              availableModels.length > 0 && div({ className: 'model-select-wrapper' },
                select({
                  className: 'form-select',
                  value: availableModels.includes(model) ? model : '',
                  onChange: e => {
                    if (e.target.value) setModel(e.target.value);
                  }
                },
                  option({ value: '' }, '-- 从已获取到的模型列表中点选 --'),
                  availableModels.map(m => option({ key: m, value: m }, m))
                )
              ),
              input({
                type: 'text',
                className: 'form-input',
                value: model,
                placeholder: '填写模型名称，或从接口查询可用模型',
                onChange: e => setModel(e.target.value)
              }),
              modelQueryMsg && p({ className: 'model-query-msg' }, modelQueryMsg)
            ),

            // Timeout Input
            div({ className: 'form-group form-row' },
              div({ className: 'col-half' },
                label({ className: 'form-label' }, '请求超时时间 (秒)'),
                input({
                  type: 'number',
                  min: 5,
                  max: 120,
                  className: 'form-input',
                  value: timeoutSeconds,
                  onChange: e => setTimeoutSeconds(Math.max(5, Math.min(120, parseInt(e.target.value, 10) || 30)))
                })
              ),
              div({ className: 'col-half form-hint-box' },
                p({ className: 'form-hint' }, '建议：普通问答 30~60s；思考模型或复习资料生成 90~120s。超时会保留已有完整资料并保护本地作答。')
              )
            ),

            // Test Connection Result Banner
            testResult && div({ className: `test-result-box ${testResult.ok ? 'test-success' : 'test-failure'}` },
              span({ className: 'test-icon' }, testResult.ok ? '✓' : '⚠️'),
              div({ className: 'test-details' },
                p({ className: 'test-title' }, testResult.ok ? '连接测试成功！' : '连接测试失败'),
                p({ className: 'test-desc' }, testResult.message || testResult.error)
              )
            ),

            saveMessage && div({ className: 'save-feedback-box' }, saveMessage),

            // Action Buttons
            div({ className: 'settings-actions' },
              button({
                type: 'button',
                className: 'btn-secondary',
                disabled: isTesting,
                onClick: handleTestConnection
              }, isTesting ? '正在测试连接...' : '⚡ 测试连接'),
              button({
                type: 'button',
                className: 'btn-primary',
                disabled: isSaving,
                onClick: handleSaveConfig
              }, isSaving ? '正在保存...' : '💾 保存配置')
            )
          ),

          activeTab === 'db' && div({ className: 'settings-tab-pane' },
            // DB File Info Card
            div({ className: 'db-info-card' },
              div({ className: 'db-card-header' },
                h3({ className: 'db-card-title' }, '📁 当前本地学习记录数据库'),
                span({ className: 'db-size-badge' }, dbInfo?.sizeFormatted || '检测中...')
              ),
              div({ className: 'db-path-box' },
                code({ className: 'db-path-text' }, dbInfo?.dbPath || '读取中...'),
                button({
                  type: 'button',
                  className: 'btn-copy-path',
                  onClick: handleCopyPath,
                  title: '复制完整文件路径'
                }, copySuccess ? '✓ 已复制' : '复制路径')
              ),
              dbInfo?.stats && div({ className: 'db-stats-grid' },
                div({ className: 'stat-pill' },
                  span({ className: 'stat-num' }, dbInfo.stats.submittedSessions),
                  span({ className: 'stat-lbl' }, '已交卷套卷')
                ),
                div({ className: 'stat-pill' },
                  span({ className: 'stat-num' }, dbInfo.stats.totalAnswers),
                  span({ className: 'stat-lbl' }, '作答记录题次')
                ),
                div({ className: 'stat-pill' },
                  span({ className: 'stat-num' }, dbInfo.stats.wrongQuestions),
                  span({ className: 'stat-lbl' }, '错题本收录题数')
                )
              )
            ),

            // Export & Import Dual Actions
            div({ className: 'db-actions-section' },
              // Action 1: Export
              div({ className: 'action-card' },
                div({ className: 'action-card-text' },
                  h4({ className: 'action-card-title' }, '一键备份与导出 (.db)'),
                  p({ className: 'action-card-desc' },
                    '采用 SQLite 在线事务快照技术，安全完整地导出当前的做题历史与错题本。可在浏览器直接下载保存。'
                  )
                ),
                button({
                  type: 'button',
                  className: 'btn-primary btn-action-btn',
                  onClick: handleExportDb
                }, '⬇️ 导出/下载数据库备份')
              ),

              // Action 2: Import
              div({ className: 'action-card' },
                div({ className: 'action-card-text' },
                  h4({ className: 'action-card-title' }, '恢复与导入数据库备份 (.db)'),
                  p({ className: 'action-card-desc' },
                    '选择此前导出的 .db 备份文件恢复。系统会自动为当前设备记录生成安全备份 (.bak) 后无缝升级替换。'
                  )
                ),
                div({ className: 'import-control-row' },
                  input({
                    type: 'file',
                    accept: '.db,application/x-sqlite3',
                    id: 'db-file-input',
                    style: { display: 'none' },
                    onChange: e => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                        setImportMsg(null);
                        setImportError(null);
                      }
                    }
                  }),
                  button({
                    type: 'button',
                    className: 'btn-secondary',
                    onClick: () => document.getElementById('db-file-input').click()
                  }, selectedFile ? `已选: ${selectedFile.name}` : '📂 选择 .db 文件'),
                  selectedFile && button({
                    type: 'button',
                    className: 'btn-danger',
                    disabled: isImporting,
                    onClick: handleImportDb
                  }, isImporting ? '正在恢复中...' : '确认恢复导入')
                ),
                importMsg && p({ className: 'import-success-msg' }, importMsg),
                importError && p({ className: 'import-error-msg' }, importError)
              )
            ),

            // Action 3: Manual Cold-Migration Guide
            div({ className: 'manual-migration-guide' },
              button({
                type: 'button',
                className: 'guide-toggle-btn',
                onClick: () => setIsGuideOpen(!isGuideOpen)
              }, `${isGuideOpen ? '▼' : '►'} 如何通过 Windows 文件管理器手动复制 db 文件进行跨设备迁移？`),
              isGuideOpen && div({ className: 'guide-content' },
                p({ className: 'guide-step' }, '【跨设备冷迁移 3 步操作法】'),
                p({ className: 'guide-step' },
                  '1. 停止服务：在启动控制台按 Ctrl+C，等待服务退出，确保学习记录已保存。'
                ),
                p({ className: 'guide-step' },
                  '2. 复制文件：打开上方显示的数据目录，复制 app.db。备份可能包含 API 密钥，请妥善保管。'
                ),
                p({ className: 'guide-step' },
                  '3. 恢复记录：在新设备先备份当前记录，再通过设置页面导入数据库，或停止服务后替换数据目录中的 app.db。'
                )
              )
            )
          )
        )
      )
    );
  }

  return SettingsModal;
});
