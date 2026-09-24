'use strict';
/** Session id accepted in the rewritten command and the statistics: shell-inert characters only. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The id itself when safe, otherwise null. */
function safeSessionId(value) {
  return SESSION_ID.test(String(value || '')) ? String(value) : null;
}

module.exports = { SESSION_ID, safeSessionId };
