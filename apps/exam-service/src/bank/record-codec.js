'use strict';

const fs = require('node:fs');
const { brotliCompressSync, brotliDecompressSync, constants } = require('node:zlib');
const { createHash } = require('node:crypto');

// Reversible packaging to discourage direct text reuse; this is not encryption.
function encodeRecord(record) {
  const bytes = Buffer.from(JSON.stringify(record));
  return {
    format: 'ruankao-bank-v1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    payload: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
    }).toString('base64')
  };
}

function decodeRecord(record) {
  if (record.format !== 'ruankao-bank-v1') return record;
  const bytes = brotliDecompressSync(Buffer.from(record.payload, 'base64'), {
    maxOutputLength: 16 * 1024 * 1024
  });
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
    throw new Error('Question bank record checksum mismatch');
  }
  return JSON.parse(bytes.toString('utf8'));
}

function readRecord(filePath) {
  return decodeRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

module.exports = { encodeRecord, decodeRecord, readRecord };
