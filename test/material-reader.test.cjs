'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
function reader() {
  const ctx = { React: { createElement: (tag, props, ...children) => ({ tag, props, children }), isValidElement: () => false } };
  ctx.self = ctx; ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync('apps/exam-web/src/utils/dom.js', 'utf8'), ctx);
  const source = fs.readFileSync('apps/exam-web/src/components/PersonalMaterialsView.js', 'utf8')
    .replace('return PersonalMaterialsView;', 'globalThis.renderFixture=renderSafeMarkdown; return PersonalMaterialsView;');
  vm.runInNewContext(source, ctx); return ctx.renderFixture;
}
function nodes(value) { return !value || typeof value !== 'object' ? [] : Array.isArray(value)
  ? value.flatMap(nodes) : [value, ...nodes(value.children)]; }

test('material reader preserves complete fenced C++ as escaped text and gives headings usable anchors', () => {
  const result = nodes(reader()('# C++ 与 Java\n\n[进入](#c-与-java)\n\n```cpp\n#include <vector>\nif (a<b) p->run();\n```\n<script>unsafe()</script>'));
  const code = result.find(node => node.tag === 'code' && node.props?.className === 'language-cpp');
  assert.equal(code.children[0], '#include <vector>\nif (a<b) p->run();');
  assert.equal(result.find(node => node.tag === 'h2').props.id, 'c-与-java');
  assert.equal(result.find(node => node.tag === 'a').props.href, '#c-与-java');
  assert.ok(!result.some(node => node.tag === 'script'));
});

test('material tables keep pipe operators inside inline code and dynamic checks remain collapsible', () => {
  const result = nodes(reader()('| 条件 | 含义 |\n|---|---|\n| `a|b` | 位运算 |\n\n- 【接口】待补：声明未填；记住：完整签名；防错：核对返回类型；自测：缺返回类型可行吗？（不可行）'));
  assert.equal(result.filter(node => node.tag === 'td').length, 2);
  assert.equal(result.find(node => node.tag === 'code').children[0], 'a|b');
  assert.equal(result.filter(node => node.tag === 'details').length, 1);
});
