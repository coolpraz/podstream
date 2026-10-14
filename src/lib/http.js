'use strict';

/** An Error carrying an HTTP status, surfaced by the global error handler. */
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Wrap an async express handler so rejections hit the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { httpError, wrap };
