'use strict';
const { createHash } = require('node:crypto');

// Public compatibility tables contain only one-way digests of old identifiers.
function identifierDigest(id) {
  return createHash('sha256').update(String(id)).digest('hex');
}

function resolveMappedIdentifier(mapping, id) {
  if (typeof id !== 'string' || !mapping) return id;
  const digest = identifierDigest(id);
  if (Object.hasOwn(mapping, digest)) return mapping[digest];
  // Plain maps remain supported for isolated fixtures and local integrations.
  return Object.hasOwn(mapping, id) ? mapping[id] : id;
}

module.exports = { identifierDigest, resolveMappedIdentifier };
