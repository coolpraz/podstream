'use strict';

// Shared mutable runtime state. Kept in one module so every feature module
// imports the same live Map instances without circular requires.

const sessions = new Map(); // id -> session
const labs = new Map(); // id -> lab

const runtime = {
  podmanVersion: null, // set by checkPodman() at startup
};

module.exports = { sessions, labs, runtime };
