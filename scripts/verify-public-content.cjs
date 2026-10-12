'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { decodeRecord } = require('../apps/exam-service/src/bank/record-codec');

const PRIVATE_FIELDS = new Set([
  'source_aliases', 'source_provenance', 'source_entities', 'source_ref',
  'paper_key', 'input_hash', 'linked_at', 'target_url', 'target_anchor',
  'target_ref_text', 'source_url', 'sourceUrl', 'user_answer', 'user_answer_json',
  'api_key', 'apiKey', 'access_token', 'refresh_token', 'cookie'
]);
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{20,}|AIza[\w-]{30,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https?:\/\/[^\s/@:]+:[^\s/@]+@)/;
const NEUTRAL_ID = /^(?:(?:oq|cg|ref)-[a-f0-9]{20}|sd-\d{4}-(?:\d{2}|unknown)-(?:objective|case)-[a-f0-9]{10})$/;

function assertPublicText(text, label) {
  assert(!SECRET_PATTERN.test(text), `Possible credential in public resource: ${label}`);
}

function assertPublicRecord(record, label) {
  function walk(value, field = '') {
    if (typeof value === 'string') {
      assertPublicText(value, label);
      // Two networking questions use this URL as the exam stimulus.
      const urls = value.match(/https?:\/\/[^\s，。<>]+/gi) || [];
      assert(urls.every(url => field === 'question_stem' && url === 'http://www.dailynews.com.cn/channel/welcome.html'), `External URL in packaged bank: ${label}`);
      assert(!/(?:paper_\d+_|student-q\d+|ruankao-sd-)/i.test(value), `Original identifier in packaged bank: ${label}`);
      if (['id', 'standard_id', 'paper_id', 'question_id', 'canonical_id', 'target_question_id', 'target_paper_id', 'canonical_paper_id', 'question_ids', 'group_ids', 'baseline_paper_ids'].includes(field)) {
        assert(NEUTRAL_ID.test(value), `Non-neutral identifier in bank: ${label}`);
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => walk(item, field));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        assert(!PRIVATE_FIELDS.has(key), `Private metadata field ${key} in bank: ${label}`);
        if (key === 'legacy_id_map') {
          assert.equal(value.legacy_id_map_format, 'sha256-v1', `Unhashed compatibility table: ${label}`);
          for (const [digest, target] of Object.entries(item)) {
            assert(/^[a-f0-9]{64}$/.test(digest), `Original compatibility identifier: ${label}`);
            assert(NEUTRAL_ID.test(target), `Non-neutral compatibility target: ${label}`);
          }
        } else {
          walk(item, key);
        }
      }
    }
  }
  walk(record);
}

function verifyPublicContent(root, files) {
  let records = 0;
  for (const file of files) {
    if (/\.(?:json|js|ts|cjs|mjs|md|html|sql|ya?ml|txt)$/.test(file) || file === 'LICENSE') {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assertPublicText(text, file);
      if (file.startsWith('题库/') && file.endsWith('.json')) {
        assertPublicRecord(decodeRecord(JSON.parse(text)), file);
        records++;
      }
    }
  }
  console.log(`Verified public text and ${records} decoded bank records; no private bank metadata or credential signatures.`);
}

module.exports = { assertPublicText, assertPublicRecord, verifyPublicContent };
