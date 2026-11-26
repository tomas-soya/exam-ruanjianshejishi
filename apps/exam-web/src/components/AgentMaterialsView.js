/** Local Agent task export and imported personal Markdown library. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('react'));
  else root.AgentMaterialsView = factory(root.React);
})(typeof self !== 'undefined' ? self : this, function (React) {
  'use strict';
  const h = React.createElement;
  const { useState, useEffect, useRef } = React;
  const MAX_BYTES = 2 * 1024 * 1024;

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor);
    anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function AgentMaterialsView({ apiClient, renderMarkdown }) {
    const [documents, setDocuments] = useState([]);
    const [selected, setSelected] = useState(null);
    const [current, setCurrent] = useState(null);
    const [draft, setDraft] = useState(null);
    const [limit, setLimit] = useState(10);
    const [subject, setSubject] = useState('all');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const sequence = useRef(0);
    const refresh = async () => setDocuments(await apiClient.listPersonalDocuments());
    useEffect(() => {
      let active = true;
      apiClient.listPersonalDocuments().then(rows => { if (active) setDocuments(rows); })
        .catch(e => { if (active) setError(e.message); });
      return () => { active = false; sequence.current++; };
    }, [apiClient]);

    async function run(action) {
      setBusy(true); setError(''); setMessage('');
      try { await action(); } catch (e) { setError(e.message || '操作失败，请重试'); }
      finally { setBusy(false); }
    }
    async function open(id, version) {
      const request = ++sequence.current;
      await run(async () => {
        const latest = await apiClient.getPersonalDocument(id);
        const value = version ? await apiClient.getPersonalDocument(id, version) : latest;
        if (sequence.current !== request) return;
        setSelected(value); setCurrent(latest); setDraft(null);
      });
    }
    async function readFile(event) {
      const file = event.target.files[0]; event.target.value = '';
      if (!file) return;
      await run(async () => {
        if (!/\.(?:md|markdown)$/i.test(file.name)) throw new Error('请选择 .md 或 .markdown 文件');
        if (file.size > MAX_BYTES) throw new Error('Markdown 文件不能超过 2 MB');
        const markdown = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        if (!markdown.trim()) throw new Error('Markdown 内容不能为空');
        setDraft({ id: current?.id, baseVersion: current?.currentVersion,
          title: current?.title || file.name.replace(/\.(?:md|markdown)$/i, '').slice(0, 120), markdown });
        setMessage('请检查下方预览，确认后点击“保存个人资料”。');
      });
    }
    function uploadLabel(text) {
      return h('label', { className: 'btn-secondary-action agent-upload' }, text,
        h('input', { type: 'file', accept: '.md,.markdown,text/markdown', disabled: busy,
          'aria-label': text, onChange: readFile }));
    }
    function reader(title, markdown) {
      return h('section', { className: 'agent-reader' }, h('h3', null, title),
        h('div', { className: 'markdown-content-box' }, renderMarkdown(markdown)));
    }
    return h('div', { className: 'agent-materials-workspace', 'aria-busy': busy },
      h('section', { className: 'agent-workflow-card' },
        h('h3', null, '1. 导出复习任务包'),
        h('p', null, '解压任务包后，让本地 Agent 阅读 TASK.md 并生成个人复习资料。包内附相关基础章节与本地图示。'),
        h('div', { className: 'agent-actions' },
          h('label', null, '最近已提交练习 ', h('input', { type: 'number', min: 1, max: 100, value: limit, disabled: busy,
            onChange: e => setLimit(e.target.value), 'aria-label': '最近练习次数' })),
          h('label', null, '题型 ', h('select', { value: subject, disabled: busy, 'aria-label': '导出题型', onChange: e => setSubject(e.target.value) },
            h('option', { value: 'all' }, '全部'), h('option', { value: 'objective' }, '选择题'), h('option', { value: 'case' }, '案例题'))),
          h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy,
            onClick: () => run(async () => {
              const count = Number(limit);
              if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('练习次数须为 1–100');
              const blob = await apiClient.exportAgentTask({ limit: count, subject });
              download(blob, '复习任务包.zip'); setMessage('任务包已下载。解压后请让本地 Agent 阅读 TASK.md。');
            }) }, busy ? '处理中…' : '下载任务包')
        ),
        h('p', { className: 'static-source-hint' }, '按范围内每题最近一次实质作答整理，排除背题练习；待评分、待复核、未作答和未选做题单独标明。导出在本机完成。')
      ),
      error && h('div', { className: 'alert-box warning', role: 'alert' }, error),
      message && h('div', { className: 'alert-box info', role: 'status' }, message),
      h('section', { className: 'agent-workflow-card' },
        h('h3', null, '2. 导入并保存个人 Markdown'),
        h('p', null, '选择文件后先预览，保存时建立新版本。个人资料仅保存在当前学习数据库，可随学习记录备份。'),
        h('div', { className: 'agent-actions' },
          h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy,
            onClick: () => { sequence.current++; setSelected(null); setCurrent(null); setDraft(null); setError(''); setMessage('请选择 Markdown 文件以新建资料。'); } }, '新建个人资料'),
          uploadLabel(current ? '导入此资料的新版本' : '选择 Markdown 文件'),
          h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy, onClick: () => run(refresh) }, '刷新列表')
        ),
        h('div', { className: 'agent-document-list' },
          !documents.length && h('p', null, '尚未保存个人资料。可导入已有的 Markdown。'),
          ...documents.map(doc => h('button', { key: doc.id, type: 'button', disabled: busy,
            className: `agent-document-button ${current?.id === doc.id ? 'active' : ''}`, onClick: () => open(doc.id) },
            doc.title, h('span', null, `v${doc.currentVersion} · ${new Date(doc.updatedAt).toLocaleString()}`)))
        )
      ),
      draft && h('section', { className: 'agent-workflow-card' },
        h('h3', null, '导入预览'),
        h('label', null, '资料标题 ', h('input', { type: 'text', value: draft.title, maxLength: 120, disabled: busy,
          onChange: e => setDraft({ ...draft, title: e.target.value }) })),
        h('p', null, '请核对结论、代码和自测答案。公式使用纯文本或 Unicode。'),
        h('div', { className: current ? 'agent-compare' : '' },
          current && reader(`当前版本 v${current.version}`, current.markdown), reader('待保存内容', draft.markdown)),
        h('div', { className: 'agent-actions' },
          h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy || !draft.title.trim(),
            onClick: () => run(async () => {
              const saved = await apiClient.savePersonalDocument(draft);
              setSelected(saved); setCurrent(saved); setDraft(null); setMessage(`已保存个人资料 v${saved.version}`); await refresh();
            }) }, '保存个人资料'),
          h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy,
            onClick: () => { setDraft(null); setMessage('已取消导入。'); } }, '取消导入')
        )
      ),
      selected && current && selected.id === current.id && !draft && h('section', { className: 'agent-workflow-card' },
        h('div', { className: 'agent-actions' },
          h('label', null, '版本 ', h('select', { value: selected.version, disabled: busy, 'aria-label': '资料版本',
            onChange: e => open(selected.id, Number(e.target.value)) },
            ...current.versions.map(v => h('option', { key: v.version, value: v.version },
              `v${v.version}${v.version === current.currentVersion ? '（当前）' : ''} · ${new Date(v.createdAt).toLocaleString()}`)))),
          h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy,
            onClick: () => download(new Blob([selected.markdown], { type: 'text/markdown;charset=utf-8' }),
              selected.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + `.v${selected.version}.md`) }, '下载此版本 Markdown'),
          selected.version !== current.currentVersion && h('button', { type: 'button', className: 'btn-secondary-action', disabled: busy,
            onClick: () => run(async () => {
              const restored = await apiClient.restorePersonalDocument(selected.id, selected.version, current.currentVersion);
              setSelected(restored); setCurrent(restored); setMessage(`已将历史内容恢复为 v${restored.version}，所有版本均保留。`); await refresh();
            }) }, '恢复此版本（保留全部历史）')
        ),
        h('div', { className: selected.version !== current.version ? 'agent-compare' : '' },
          selected.version !== current.version && reader(`当前版本 v${current.version}`, current.markdown),
          reader(`${selected.title} · v${selected.version}`, selected.markdown))
      )
    );
  }
  return AgentMaterialsView;
});
