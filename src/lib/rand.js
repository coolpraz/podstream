'use strict';

const crypto = require('crypto');

/** Random hex id of n bytes (2n chars) — member/lab/pull-job ids. */
const hex = (n) => crypto.randomBytes(n).toString('hex');

module.exports = { hex };
