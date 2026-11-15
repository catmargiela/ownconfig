#!/usr/bin/env node
'use strict';
/**
 * References of a page that are gone (`vault-lint --refs`, skill `vault-tidy`)
 * and journal dates. Launched by `node test.js`; usable alone. Temporary HOME
 * and vault: the real ones are never touched.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-vr-')));
const HOME = path.join(TMP, 'home');
const VAULT = path.join(TMP, 'vault');
fs.mkdirSync(path.join(HOME, 'notes'), { recursive: true });
fs.mkdirSync(path.join(VAULT, 'Claude', 'Projets'), { recursive: true });
Object.assign(process.env, { HOME, CC_VAULT: VAULT, CC_VAULT_DISABLED: '' });

let pass = 0, fail = 0;
const group = (name) => console.log(`\n  ${name}`);
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  (obtenu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`}`);
}
const R = require('./hooks/lib/vault/refs');
const naming = require('./hooks/lib/vault/naming');

const repo = path.join(TMP, 'acme-shop');
fs.mkdirSync(path.join(repo, 'src', 'lib'), { recursive: true });
fs.mkdirSync(path.join(repo, 'docs', 'guide'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'lib', 'cart.ts'), '');
fs.writeFileSync(path.join(repo, 'README.md'), '');
fs.writeFileSync(path.join(HOME, 'notes', 'kept.md'), '');
const git = (...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
if (HAS_GIT) { git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'init'); git('branch', 'feat/cart'); }

const page = `---
type: projet
chemin: ${repo}
note: \`src/lib/in-frontmatter.ts\`
---

# Acme

Le panier est dans \`src/lib/cart.ts\`, l'ancien dans \`src/lib/basket.ts\`.
Voir \`README.md\`, \`docs/guide\`, \`docs/OLD.md\` et \`src/lib/cart.ts:12\`.
Notes perso : \`~/notes/kept.md\` et \`~/notes/lost.md\`.
Serveur : \`/etc/caddy/Caddyfile\`, \`deploy/.env\`, \`https://example.com/a/b\`, \`npm run build\`, \`foo/<id>/bar\`.
Branches : \`feat/cart\` (en cours), \`feat/checkout\` (fusionnée), \`docs/guide\`.
Encore \`src/lib/basket.ts\`.

## Sessions

<!-- claude:journal:start -->
- \`src/lib/in-region.ts\`
<!-- claude:journal:end -->
`;
group('Références disparues');
const refs = R.staleRefs(page, [repo]);
const tokens = (kind) => refs.filter((r) => r.kind === kind).map((r) => r.token);
check('fichiers du dépôt et du dossier personnel qui n\'existent plus', tokens('chemin'), ['src/lib/basket.ts', 'docs/OLD.md', '~/notes/lost.md']);
check('numéro de ligne dans le fichier, et la ligne citée', [refs[0].line, page.split('\n')[refs[0].line - 1].startsWith('Le panier est dans')], [9, true]);
check('jamais signalés : serveur, dossier inconnu, URL, commande, gabarit, frontmatter, bloc géré',
  refs.some((r) => /caddy|\.env|example|npm|<id>|frontmatter|in-region/.test(r.token)), false);
if (HAS_GIT) check('branche absente signalée ; présente, ou dossier du même nom : non', tokens('branche'), ['feat/checkout']);
check('chaque référence une seule fois', refs.filter((r) => r.token === 'src/lib/basket.ts').length, 1);
check('dossier de la page disparu : rien n\'est jugé', R.staleRefs(page, [path.join(TMP, 'gone')]), []);
check('page vide ou sans backtick : aucune erreur', [R.staleRefs('', [repo]), R.staleRefs('# Titre\n\ntexte', [repo])], [[], []]);

fs.writeFileSync(path.join(VAULT, 'Claude', 'Projets', 'Acme.md'), page);
const lint = spawnSync(process.execPath, [path.join(__dirname, 'vault-lint.js'), '--refs', repo], { encoding: 'utf8' });
check('vault-lint --refs : page, ligne et référence affichées',
  [lint.status, lint.stdout.includes('Page : Projets/Acme.md'), lint.stdout.includes('l.9 chemin `src/lib/basket.ts`')], [0, true, true]);
const before = fs.readFileSync(path.join(VAULT, 'Claude', 'Projets', 'Acme.md'), 'utf8');
check('lecture seule : page inchangée', before, page);
const none = spawnSync(process.execPath, [path.join(__dirname, 'vault-lint.js'), '--refs', path.join(TMP, 'nowhere')], { encoding: 'utf8' });
check('dossier sans page : dit, sortie 0', [none.status, none.stdout.includes('Aucune page')], [0, true]);

group('Date des journaux');
check('date locale, pas UTC : 00 h 30 appartient au nouveau jour', naming.today(new Date(2026, 10, 16, 0, 30)), '2026-11-16');
check('fin de journée : encore le même jour', naming.today(new Date(2026, 10, 16, 23, 59)), '2026-11-16');
check('mois et jour sur deux chiffres', naming.today(new Date(2027, 0, 5, 12, 0)), '2027-01-05');
check('journal du jour nommé à la date locale', path.basename(naming.journalFile('Acme')).startsWith(naming.today()), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n  entretien des pages, dates : ${pass} réussis, ${fail} échoués sur ${pass + fail}`);
process.exit(fail ? 1 : 0);
