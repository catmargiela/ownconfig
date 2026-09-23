'use strict';
/**
 * Obsidian bridge — Claude Code's long-term memory.
 *
 *   PreCompact   → writes the session into the vault BEFORE the context is lost
 *   Stop         → incremental capture, one block per session updated in place
 *   SessionStart → re-injects the profile + project page + latest results, under budget
 *
 * Absolute rule: hooks only write inside `<!-- claude:xxx:start -->` …
 * `<!-- claude:xxx:end -->` regions (plus the journal frontmatter keys they own).
 * Everything else belongs to the user and is never rewritten.
 *
 * This file is a facade: the work lives in `./vault/*`.
 */
const fs = require('fs');
const path = require('path');
const { readState, writeState } = require('./util');
const store = require('./vault/store');
const naming = require('./vault/naming');
const transcript = require('./vault/transcript');
const filters = require('./vault/filters');
const capture = require('./vault/capture');
const render = require('./vault/render');
const pages = require('./vault/pages');
const dashboard = require('./vault/dashboard');
const inject = require('./vault/inject');

const STATE = 'vault';

function sessionKey(input) {
  const raw = input?.session_id || store.hash(String(input?.transcript_path || '')).slice(0, 16);
  return String(raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'nosession';
}

/** Reads what the transcript appended since the previous pass and folds it in. */
function advance(prev, transcriptPath, root) {
  const base = prev && prev.v === 2 ? prev : capture.emptyAcc();
  const { entries, offset, reset } = transcript.readSince(transcriptPath, base.offset || 0);
  const start = reset ? { ...capture.emptyAcc(), journal: base.journal, entry: base.entry } : base;
  const acc = capture.ingest(start, entries, root);
  return { acc: { ...acc, offset }, changed: entries.length > 0 };
}

const hasWork = (acc) => acc.files.length > 0 || acc.commits.length > 0 || acc.prs.length > 0;

/** Journal of the session: the one it started in, else today's. */
function sessionJournal(acc, name) {
  return acc.journal && fs.existsSync(acc.journal) ? acc.journal : naming.journalFile(name);
}

/** Writes journal block, project page entry and dashboard. Returns the new accumulator. */
function record(acc, input, root, sid) {
  store.ensureDirs();
  const name = naming.projectName(input.cwd);
  const pageFile = pages.ensureProjectPage(name, input.cwd);
  const page = path.basename(pageFile, '.md');
  const journal = sessionJournal(acc, name);
  const fallbackBranch = naming.currentBranch(input.cwd);
  const body = render.renderSession(acc, {
    repo: acc.commits.length ? naming.githubRepo(root) : null,
    branch: fallbackBranch,
  });
  const branches = acc.branches.length ? acc.branches : [fallbackBranch].filter(Boolean);
  pages.writeSession(journal, { sid, body, name, page, branches });
  const entry = pages.updateProjectEntries(pageFile, path.basename(journal, '.md'), render.sessionHeadline(acc), acc.entry);
  dashboard.updateDashboard();
  return { ...acc, journal, entry };
}

/**
 * Stop (`fromStop`): nothing is read before the session has edited a file;
 * afterwards only appended bytes are parsed, and a block is written only when
 * files, commits or PRs exist. PreCompact also records a session of asks only.
 */
function captureSession(input, fromStop) {
  if (!store.enabled() || !input?.transcript_path) return;
  const sid = sessionKey(input);
  const prev = readState(sid, STATE, null);
  if (!prev && fromStop && !readState(input.session_id, 'edited', []).length) return;
  const root = naming.projectDir(input.cwd);
  const { acc, changed } = advance(prev, input.transcript_path, root);
  const worth = hasWork(acc) || (!fromStop && acc.asks.length > 0);
  if (!worth || (fromStop && !changed && prev?.journal)) { writeState(sid, STATE, acc); return; }
  writeState(sid, STATE, record(acc, input, root, sid));
}

/** PreCompact: the moment the context is about to be lost. */
function onCompact(input) { captureSession(input, false); }

/** Stop: capture at the end of every answer, one block per session. */
function onStop(input) { captureSession(input, true); }

/** SessionStart: stdout is injected into the context — hence the budgets. */
function onStart(input) {
  if (!store.enabled()) return;
  const out = inject.buildInjection(input?.cwd);
  if (out) process.stdout.write(out);
}

/** One-shot summary of a list of entries (former API, used by tests and tools). */
function distill(entries, root = null) {
  const acc = capture.ingest(capture.emptyAcc(), entries || [], root);
  return {
    ...acc,
    failed: acc.errors,
    lastState: filters.excerpt(acc.lastText, 15),
    result: filters.headline(acc.lastText),
  };
}

module.exports = {
  onCompact, onStop, onStart, buildInjection: inject.buildInjection,
  VAULT: store.VAULT, ROOT: store.ROOT, DIRS: store.DIRS, BUDGET: store.BUDGET,
  projectName: naming.projectName, projectDir: naming.projectDir, distill, isUserAsk: filters.isUserAsk,
  upsertRegion: store.upsertRegion, cleanForInjection: inject.cleanForInjection, tailSections: inject.tailSections,
  readRegion: store.readRegion, stripRegions: store.stripRegions, ensureDirs: store.ensureDirs,
  ensureProjectPage: pages.ensureProjectPage, projectFile: naming.projectFile,
  resolveProjectFile: naming.resolveProjectFile, journalFile: naming.journalFile,
  readBounded: transcript.readBounded, vaultStatus: store.vaultStatus, writeGuarded: store.writeGuarded,
  withLock: store.withLock, hash: store.hash, read: store.read, write: store.write,
  sessionKey, ensureDashboard: dashboard.ensureDashboard, linkFromIndex: dashboard.linkFromIndex,
  DASHBOARD: dashboard.DASHBOARD, DASHBOARD_TEMPLATE: dashboard.TEMPLATE,
};
