/**
 * MaterialModal Component
 * Built-in pure Markdown viewer for Ruankao study materials.
 * STRICT ZERO EXTERNAL RENDERING DEPENDENCY:
 * No MathJax, KaTeX, or LaTeX plugins. Uses standard Unicode and clean typography.
 * Supports auto-scrolling to material anchor headings.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.MaterialModal = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, h2, h3, h4, p, pre, code, table, thead, tbody, tr, th, td, hr, ul, ol, li, blockquote } = DOM;
  const { useState, useEffect, useRef } = React;

  /**
   * Lightweight Pure Markdown to React Parser
   * Zero external dependencies, pure standard JS.
   */
  function parsePureMarkdown(markdownText, targetAnchor) {
    if (!markdownText) return [];

    const lines = markdownText.replace(/\r\n/g, '\n').split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeBuffer = [];
    let codeLang = '';
    let inTable = false;
    let tableRows = [];

    const flushTable = () => {
      if (tableRows.length === 0) return;
      const headerRow = tableRows[0];
      const bodyRows = tableRows.slice(1).filter(row => !row.every(cell => /^[-: ]+$/.test(cell)));

      elements.push(
        table({ key: `tbl-${elements.length}`, className: 'material-table' },
          thead(null,
            tr(null, headerRow.map((cell, idx) => th({ key: idx }, cell.trim())))
          ),
          tbody(null,
            bodyRows.map((row, rIdx) =>
              tr({ key: rIdx }, row.map((cell, cIdx) => td({ key: cIdx }, cell.trim())))
            )
          )
        )
      );
      tableRows = [];
      inTable = false;
    };

    const renderInline = (text) => {
      // Handles **bold**, `code`, and plain text
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
          parts.push(code({ key: `c-${match.index}`, className: 'inline-code' }, match[4]));
        }
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }
      return parts.length > 0 ? parts : text;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            div({ key: `code-${elements.length}`, className: 'material-code-container' },
              pre({ className: 'material-code-pre' },
                code({ className: `language-${codeLang || 'text'}` }, codeBuffer.join('\n'))
              )
            )
          );
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          flushTable();
          inCodeBlock = true;
          codeLang = line.trim().slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Tables
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line.split('|').slice(1, -1);
        tableRows.push(cells);
        inTable = true;
        continue;
      } else if (inTable) {
        flushTable();
      }

      const trimmed = line.trim();

      // Headings
      if (trimmed.startsWith('# ')) {
        const title = trimmed.slice(2).trim();
        const id = title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
        elements.push(h2({ key: `h1-${i}`, id, className: 'material-h1' }, renderInline(title)));
      } else if (trimmed.startsWith('## ')) {
        const title = trimmed.slice(3).trim();
        const id = title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
        elements.push(h3({ key: `h2-${i}`, id, className: 'material-h2' }, renderInline(title)));
      } else if (trimmed.startsWith('### ')) {
        const title = trimmed.slice(4).trim();
        const id = title.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-');
        elements.push(h4({ key: `h3-${i}`, id, className: 'material-h3' }, renderInline(title)));
      } else if (trimmed.startsWith('> ')) {
        elements.push(blockquote({ key: `bq-${i}`, className: 'material-blockquote' }, renderInline(trimmed.slice(2).trim())));
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        elements.push(li({ key: `li-${i}`, className: 'material-li' }, renderInline(trimmed.slice(2).trim())));
      } else if (/^\d+\.\s/.test(trimmed)) {
        elements.push(li({ key: `oli-${i}`, className: 'material-li-ordered' }, renderInline(trimmed.replace(/^\d+\.\s/, ''))));
      } else if (trimmed === '---' || trimmed === '***') {
        elements.push(hr({ key: `hr-${i}`, className: 'material-hr' }));
      } else if (trimmed.length > 0) {
        elements.push(p({ key: `p-${i}`, className: 'material-p' }, renderInline(trimmed)));
      }
    }

    if (inTable) flushTable();

    return elements;
  }

  function MaterialModal({
    isOpen,
    materialAnchor, // { chapter, topic, relativeDocPath, anchorHeading }
    materialContent, // raw markdown string
    error = null,
    isLoading = false,
    onClose,
    onOpenChat
  }) {
    const contentRef = useRef(null);

    // ESC to close
    useEffect(() => {
      if (!isOpen) return;
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Scroll to anchor after render
    useEffect(() => {
      if (isOpen && materialAnchor && materialAnchor.anchorHeading && contentRef.current) {
        setTimeout(() => {
          const anchorText = materialAnchor.anchorHeading.replace(/^#+/, '').trim().toLowerCase();
          const headings = contentRef.current.querySelectorAll('h2, h3, h4');
          for (const heading of headings) {
            if (heading.textContent.toLowerCase().includes(anchorText)) {
              heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
              heading.classList.add('highlight-target-heading');
              setTimeout(() => heading.classList.remove('highlight-target-heading'), 2500);
              break;
            }
          }
        }, 300);
      }
    }, [isOpen, materialAnchor, materialContent]);

    if (!isOpen) return null;

    const parsedElements = parsePureMarkdown(materialContent, materialAnchor ? materialAnchor.anchorHeading : null);

    return div({ className: 'material-modal-backdrop', onClick: onClose },
      div({ className: 'material-modal-container', onClick: (e) => e.stopPropagation() },
        // Modal Header
        div({ className: 'material-modal-header' },
          div({ className: 'material-header-meta' },
            span({ className: 'material-badge' }, '考点精讲'),
            materialAnchor && span({ className: 'material-chapter' }, materialAnchor.chapter || '章节资料'),
            materialAnchor && materialAnchor.anchorHeading && span({ className: 'material-anchor-tag' }, `定位锚点：${materialAnchor.anchorHeading}`)
          ),
          div({ className: 'material-header-actions' },
            onOpenChat && button({
              type: 'button',
              className: 'btn-modal-ask-chat',
              onClick: () => onOpenChat({
                type: 'material',
                targetId: materialAnchor ? (materialAnchor.relativeDocPath || materialAnchor.docPath) : 'material',
                title: `考点讲义：${(materialAnchor && materialAnchor.chapter) || '章节资料'}`,
                chapter: materialAnchor && materialAnchor.chapter
              }),
              title: '向 AI 助教咨询本考点精讲'
            }, '🤖 考点答疑'),
            button({
              className: 'btn-material-close',
              onClick: onClose,
              title: '关闭 (Esc)'
            }, '✕')
          )
        ),

        // Modal Body
        div({ className: 'material-modal-body', ref: contentRef },
          isLoading ? div({ className: 'material-loading' }, '正在加载考点资料...') :
          error ? div({ className: 'material-empty material-error' },
            p({ style: { color: '#e53e3e', fontWeight: 'bold' } }, error),
            materialAnchor && p(null, `目标资料路径：${materialAnchor.relativeDocPath}`),
            materialAnchor && materialAnchor.anchorHeading && p(null, `目标锚点：${materialAnchor.anchorHeading}`)
          ) :
          !materialContent ? div({ className: 'material-empty' },
            p(null, '未找到指定考点资料文档或该资料尚未生成。'),
            materialAnchor && p(null, `资料路径：${materialAnchor.relativeDocPath}`)
          ) :
          div({ className: 'markdown-rendered-view' }, parsedElements)
        )
      )
    );
  }

  return MaterialModal;
});
