/**
 * CodeBlock Component
 * Monospace code display with line numbers, syntax accents, language badge,
 * and copy-to-clipboard functionality.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'), require('../utils/dom'));
  } else {
    root.CodeBlock = factory(root.React, root.DOM);
  }
})(typeof self !== 'undefined' ? self : this, function (React, DOM) {
  'use strict';

  const { div, span, button, pre, code } = DOM;
  const { useState } = React;

  function CodeBlock({ code: codeText, language = 'c', title }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(codeText).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
          setCopied(false);
        });
      }
    };

    // Split code into lines for line-number display
    const lines = (codeText || '').replace(/\r\n/g, '\n').split('\n');

    return div({ className: 'code-block-container' },
      div({ className: 'code-block-header' },
        div({ className: 'code-header-left' },
          span({ className: 'code-lang-badge' }, (language || 'CODE').toUpperCase()),
          title && span({ className: 'code-title' }, title)
        ),
        button({
          className: `btn-copy-code ${copied ? 'copied' : ''}`,
          onClick: handleCopy,
          title: '复制代码'
        }, copied ? '已复制 ✓' : '复制')
      ),
      div({ className: 'code-block-body' },
        div({ className: 'line-numbers' },
          lines.map((_, idx) => span({ key: idx, className: 'line-num' }, idx + 1))
        ),
        pre({ className: 'code-content' },
          code({ className: `language-${language}` }, codeText)
        )
      )
    );
  }

  return CodeBlock;
});
