/**
 * React Declarative DOM Helper
 * Provides convenient factory functions for React.createElement
 * with zero build/compile overhead.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('react'));
  } else {
    root.DOM = factory(root.React);
  }
})(typeof self !== 'undefined' ? self : this, function (React) {
  'use strict';

  const h = React.createElement;

  function createTag(tagName) {
    return function (props, ...children) {
      if (props === null || props === undefined || typeof props !== 'object' || React.isValidElement(props) || Array.isArray(props)) {
        return h(tagName, null, props, ...children);
      }
      return h(tagName, props, ...children);
    };
  }

  const tags = [
    'div', 'span', 'p', 'a', 'button', 'input', 'textarea', 'select', 'option',
    'label', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'pre', 'code', 'nav',
    'header', 'footer', 'main', 'section', 'article', 'aside', 'dialog', 'hr',
    'b', 'strong', 'i', 'em', 'small', 'badge', 'blockquote'
  ];

  const baseDOM = {
    h,
    Fragment: React.Fragment
  };

  for (const tag of tags) {
    baseDOM[tag] = createTag(tag);
  }

  const DOM = new Proxy(baseDOM, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop !== 'then') {
        target[prop] = createTag(prop);
        return target[prop];
      }
      return undefined;
    }
  });

  return DOM;
});
