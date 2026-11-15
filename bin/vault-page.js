#!/usr/bin/env node
'use strict';
/**
 * vault-page — where does a note about this folder go?
 *
 *   node ~/.claude/bin/vault-page.js [dir] [--json]
 *
 * Prints the project page covering `dir` (default: the current directory),
 * creating it when the folder is a project that has none yet. The `vault-note`
 * skill writes there and nowhere else: a page name is never chosen by hand,
 * which is how pages used to end up unreachable.
 *
 * A folder outside git gets a page here, because the note is deliberate; the
 * home directory, Claude Code's own folder and session scratchpads never do.
 *
 * Exit codes: 0 page path printed; 1 the folder cannot have a page — the path
 * of today's journal is printed instead and the reason goes to stderr;
 * 2 the vault is inactive.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(path.dirname(fs.realpathSync(__filename)), '..');
const lib = (name) => require(path.join(REPO, 'hooks', 'lib', 'vault', name));
const store = lib('store.js');
const naming = lib('naming.js');
const identity = lib('identity.js');
const pages = lib('pages.js');

function locate(dir) {
  const existed = fs.existsSync(naming.resolveProjectFile(dir));
  const page = pages.ensureProjectPage(naming.projectName(dir), dir, true);
  if (page) {
    return { page, name: path.basename(page, '.md'), paths: identity.declaredPaths(store.read(page)), existed };
  }
  const name = naming.projectName(dir);
  const journal = naming.journalFile(name);
  if (!fs.existsSync(journal)) store.write(journal, pages.journalTemplate(name, null, naming.today()));
  return { page: null, name, journal, why: identity.canHavePage(dir).why };
}

function main() {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
  const status = store.vaultStatus();
  if (!status.ok) {
    process.stderr.write(`Vault inactif : ${status.why}\n`);
    process.exit(2);
  }
  store.ensureDirs();
  const found = locate(dir);
  if (args.includes('--json')) process.stdout.write(JSON.stringify(found) + '\n');
  else process.stdout.write(`${found.page || found.journal}\n`);
  if (!found.page) {
    process.stderr.write(`Pas de page projet pour ce dossier (${found.why}) : écrire dans le journal du jour.\n`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { locate };
