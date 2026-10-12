'use strict';
const { startUnifiedServer } = require('../exam-service/src/unified-server');
startUnifiedServer({ host: process.env.HOST || '127.0.0.1', loadAllPapers: true }).then(({close}) => { for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => close().finally(() => process.exit(0))); }).catch(err => { console.error(err); process.exitCode = 1; });
