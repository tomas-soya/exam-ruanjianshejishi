'use strict';

const path = require('path');

let contracts;
try {
  contracts = require('../../exam-contracts/dist/index.js');
} catch {
  contracts = require(path.resolve(__dirname, '../../exam-contracts/dist/index.js'));
}

module.exports = contracts;
