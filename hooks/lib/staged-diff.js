'use strict';
/**
 * Lecture rapide du contenu INDEXÉ d'un dépôt, pour commit-gate.
 *
 * Chaque appel externe a un timeout de 3 s, et l'ensemble tient dans un budget
 * global sous le timeout du hook (10 s). Toute erreur renvoie null : l'appelant
 * laisse alors passer le commit sans rien dire.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CALL_TIMEOUT = 3000;
const BUDGET = 7000;
const MAX_GO_FILES = 20;

/** Horloge partagée par les appels d'un même contrôle. */
function deadline(ms = BUDGET) {
  const end = Date.now() + ms;
  return () => Math.min(CALL_TIMEOUT, end - Date.now());
}

/** Exécute un binaire ; renvoie stdout, ou null (échec, timeout, absent). */
function exec(bin, args, { cwd, left }) {
  const timeout = left();
  if (timeout <= 50) return null;
  try {
    return execFileSync(bin, args, {
      cwd, timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      // Lecture seule : aucun verrou d'index pris, aucun hook imbriqué actif.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', CCX_DISABLED: '1' },
    });
  } catch { return null; }
}

function toplevel(cwd, left) {
  const out = exec('git', ['rev-parse', '--show-toplevel'], { cwd, left });
  return out ? out.trim() : null;
}

/**
 * Diff de l'index (fichiers ajoutés, copiés, modifiés, renommés), en un appel :
 * { files, added: [{ file, line, text }] } — chemins relatifs à la racine.
 */
function stagedDiff(top, left) {
  const out = exec('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '-U0', '--no-color',
    '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/',
    '--diff-filter=ACM'], { cwd: top, left });
  return out === null ? null : parseAdded(out);
}

function parseAdded(diff) {
  const files = [];
  const added = [];
  let file = null;
  let line = 0;
  let prev = '';
  for (const l of diff.split('\n')) {
    const header = l.startsWith('+++ ') && prev.startsWith('--- ');
    prev = l;
    if (header) {
      file = l === '+++ /dev/null' ? null : l.slice(4).replace(/^b\//, '');
      if (file) files.push(file);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!file) continue;
    if (l.startsWith('+')) { added.push({ file, line, text: l.slice(1) }); line += 1; }
  }
  return { files, added };
}

/**
 * Fichiers Go indexés non conformes à gofmt. Le contenu INDEXÉ est extrait dans
 * un dossier temporaire (un seul `checkout-index`), puis un seul `gofmt -l`.
 * null quand gofmt est absent ou que l'extraction échoue.
 */
function gofmtDirty(top, goFiles, left) {
  if (!goFiles.length) return [];
  const files = goFiles.slice(0, MAX_GO_FILES);
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-gofmt-'));
    const prefix = tmp + path.sep;
    if (exec('git', ['checkout-index', `--prefix=${prefix}`, '--', ...files], { cwd: top, left }) === null) return null;
    const out = exec('gofmt', ['-l', ...files.map((f) => path.join(tmp, f))], { cwd: top, left });
    if (out === null) return null;
    return out.split('\n').filter(Boolean).map((p) => path.relative(tmp, p));
  } catch { return null; } finally {
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { deadline, toplevel, stagedDiff, parseAdded, gofmtDirty, MAX_GO_FILES };
