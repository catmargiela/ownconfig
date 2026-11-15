#!/usr/bin/env node
'use strict';
/**
 * Diagnostic du vault, orienté coût et atteignabilité.
 *
 * Un lint de vault classique cherche les liens morts. Le nôtre répond d'abord à
 * deux questions : chaque page est-elle retrouvée depuis les dossiers qu'elle
 * décrit, et combien un projet coûte-t-il en tokens au démarrage de session.
 * Lecture seule : rien n'est jamais écrit.
 *
 *   node vault-lint.js [--verbose]             tout le vault
 *   node vault-lint.js --project [dir] [--show] ce qu'une session reçoit dans `dir`
 *   node vault-lint.js --refs [dir]            fichiers et branches cités par la page et disparus
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = path.dirname(fs.realpathSync(__filename));
const store = require(path.join(HERE, 'hooks', 'lib', 'vault', 'store.js'));
const { auditVault, projectReport } = require(path.join(HERE, 'hooks', 'lib', 'vault', 'audit.js'));

const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes('--verbose');
const pad = (s, n) => String(s).padEnd(n);
const tilde = (p) => store.printable(String(p).replace(os.homedir(), '~'));

function bloc(titre, items, fmt) {
  if (!items.length) return;
  console.log(`\n  ${titre} (${items.length})`);
  const vus = VERBOSE ? items : items.slice(0, 8);
  for (const it of vus) console.log('    ' + fmt(it));
  if (items.length > vus.length) console.log(`    … +${items.length - vus.length} (--verbose)`);
}

function printProject(dir) {
  const r = projectReport(dir);
  console.log(`\n  Dossier : ${tilde(r.dir)}`);
  if (r.page) {
    console.log(`  Page    : Projets/${r.name}.md`);
    console.log(`  Couvre  : ${r.paths.length ? r.paths.map(tilde).join(', ') : '(aucun `chemin:` — trouvée par le nom du dossier seulement)'}`);
    console.log(`  Contenu : ${r.written} car. écrits, ${r.injected} injectés` +
      (r.summarised ? `  (sommaire : la page dépasse le budget de ${r.budget})` : ''));
  } else {
    console.log(`  Page    : aucune${r.canHavePage.ok ? ' (créée à la première session qui édite un fichier)' : ` — ${r.canHavePage.why}`}`);
  }
  if (r.conflict.length > 1) console.log(`  ⚠ Doublon : ${r.conflict.join(', ')} déclarent ce dossier ; ${r.name} est utilisée`);
  console.log(`  Dernière session : ${r.lastSession ? 'injectée' : 'aucune'}`);
  console.log(`  Coût au démarrage : ~${r.startTokens} tokens`);
  if (ARGS.includes('--show')) console.log(`\n${store.printable(r.injection, true) || '  (rien n\'est injecté)'}`);
  else console.log('\n  --show pour voir le texte exact injecté.');
  console.log('');
}

function printVault() {
  const a = auditVault();
  console.log(`\n  Vault : ${tilde(store.ROOT)}`);
  console.log(`  ${a.counts.projets} projet(s), ${a.counts.journaux} journal/journaux\n`);

  console.log('  COÛT AU DÉMARRAGE DE SESSION');
  console.log(`  ${pad('projet', 26)} ${pad('total', 11)} page (écrit → injecté)`);
  console.log('  ' + '─'.repeat(62));
  for (const p of [...a.pages].sort((x, y) => y.startTokens - x.startTokens)) {
    console.log(`  ${pad(p.name.slice(0, 25), 26)} ${pad('~' + p.startTokens + ' tok', 11)} ${p.written} → ${p.injected} car.` +
      (p.paths.length ? '' : '   ⚠ sans `chemin:`'));
  }
  if (!a.pages.length) console.log('  (aucune page projet — elles se créent à la première session qui édite un fichier)');

  bloc('PAGES SANS `chemin:` — injectées seulement si elles portent le nom du dossier', a.sansChemin, (n) => `Projets/${n}.md`);
  bloc('DOUBLONS — plusieurs pages pour un même dossier', a.doublons, (d) => `${d.pages.join(', ')} → ${d.winner} est utilisée`);
  bloc('PAGES HORS PROJET — dossier qui ne devrait pas avoir de page', a.horsProjet, (p) => `Projets/${p.name}.md : ${p.why}`);
  bloc('PAGES MUETTES — que des placeholders, injectent zéro', a.muettes, (n) => `Projets/${n}.md`);
  bloc('PAGES VOLUMINEUSES — relire et élaguer', a.grosses, (p) => `Projets/${p.name}.md : ${p.raw} car.`);
  bloc('LIENS CASSÉS', a.liensCasses, (l) => `${store.printable(l.page)} → [[${store.printable(l.target)}]]`);
  bloc('PAGES PROJET SANS SESSION ENREGISTRÉE', a.inutilisees, (n) => `Projets/${n}.md`);

  const total = a.sansChemin.length + a.doublons.length + a.horsProjet.length + a.muettes.length +
    a.grosses.length + a.liensCasses.length + a.inutilisees.length;
  bloc('PAGES INJECTÉES EN SOMMAIRE — plus longues que le budget, rien à corriger', a.resumees,
    (p) => `Projets/${p.name}.md : ${p.written} car. écrits, ${p.injected} injectés`);
  const pire = a.pages.length ? Math.max(...a.pages.map((p) => p.startTokens)) : 0;
  console.log(`\n  ${total === 0 ? 'Aucun problème détecté.' : total + ' point(s) à regarder.'}`);
  console.log(`  Session la plus chère : ~${pire} tokens de contexte injecté.\n`);
}

function printRefs(dir) {
  const { staleRefs } = require(path.join(HERE, 'hooks', 'lib', 'vault', 'refs.js'));
  const r = projectReport(dir);
  if (!r.page) return console.log(`\n  Aucune page pour ${tilde(dir)}.\n`);
  const dirs = r.paths.length ? r.paths : [dir];
  const refs = staleRefs(store.read(r.page), dirs);
  console.log(`\n  Page : Projets/${r.name}.md — ${refs.length} référence(s) introuvable(s) sur cette machine`);
  for (const x of refs) {
    console.log(`    l.${x.line} ${x.kind} \`${store.printable(x.token)}\``);
    console.log(`        ${store.printable(x.text).slice(0, 160)}`);
  }
  console.log(refs.length ? '\n  Une référence disparue signale souvent une note périmée — à vérifier, pas à supprimer d\'office.\n' : '');
}

const st = store.vaultStatus();
if (!st.ok) { console.error(`Vault inactif : ${store.printable(st.why)}`); process.exit(1); }

const dirAfter = (flag) => {
  const next = ARGS[ARGS.indexOf(flag) + 1];
  return path.resolve(next && !next.startsWith('--') ? next : process.cwd());
};
if (ARGS.includes('--project')) printProject(dirAfter('--project'));
else if (ARGS.includes('--refs')) printRefs(dirAfter('--refs'));
else printVault();
