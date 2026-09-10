'use strict';
/**
 * PreToolUse / Edit|Write|MultiEdit
 *
 *  1. config-protection — refuse d'affaiblir un linter/formatter/typechecker.
 *  2. fact-forcing gate (profil `strict`) — refuse la première écriture sur un
 *     fichier tant que l'agent n'a pas énoncé les faits qui l'entourent.
 *     Demander « tu es sûr ? » à un LLM ne produit rien ; exiger des faits force
 *     une investigation réelle.
 */
const path = require('path');
const { enabled, readState, writeState, deny, tilde } = require('./util');

/** Fichiers dont la modification affaiblirait une garantie plutôt que corriger le code. */
const GUARDRAIL_FILES = [
  /^\.eslintrc(\..*)?$/i, /^eslint\.config\.[cm]?[jt]s$/i,
  /^\.prettierrc(\..*)?$/i, /^prettier\.config\.[cm]?[jt]s$/i,
  /^biome\.jsonc?$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^\.ruff\.toml$/i, /^ruff\.toml$/i, /^mypy\.ini$/i, /^\.flake8$/i,
  /^\.editorconfig$/i,
];

function isGuardrail(filePath) {
  const base = path.basename(filePath || '');
  return GUARDRAIL_FILES.some((re) => re.test(base));
}

function guardrailMsg(filePath) {
  return [
    '[Guardrail Protection] Modification refusée : ' + tilde(filePath),
    '',
    "Ce fichier définit une garantie (lint / format / types). L'assouplir fait",
    'disparaître le symptôme, pas le défaut.',
    '',
    '  → Corriger le code qui viole la règle.',
    "  → Si la règle est réellement inadaptée, l'expliquer à l'utilisateur et",
    '    demander son accord avant de toucher à ce fichier.',
    '',
    'Contournement explicite (à ne poser que sur demande) : CCX_ALLOW_CONFIG=1',
  ].join('\n');
}

function factMsg(filePath, isNew) {
  const f = tilde(filePath);
  const body = isNew
    ? ['1. Nommer le(s) fichier(s) et la ligne qui appelleront ce nouveau fichier',
       '2. Confirmer, recherche à l\'appui (Glob/Grep), qu\'aucun fichier existant ne remplit déjà ce rôle']
    : ['1. Lister TOUS les fichiers qui importent celui-ci (Glob/Grep sur l\'arborescence)',
       '2. Lister les fonctions/classes publiques que ce changement affecte'];
  return [
    '[Fact-Forcing Gate] ' + (isNew ? 'Avant de créer ' : 'Avant de modifier ') + f + ', énoncer ces faits :',
    '',
    ...body,
    '3. Si le fichier lit ou écrit des données : nommer les champs et le format',
    "4. Citer mot pour mot l'instruction en cours de l'utilisateur",
    '',
    'Énoncer les faits, puis relancer la même opération (elle passera).',
    'Désactiver ce gate : CC_PROFILE=standard',
  ].join('\n');
}

function run(input) {
  const filePath = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!filePath) return;

  // 1. Guardrail protection — actif dès `standard`, coût nul, gain immédiat.
  if (enabled(['standard', 'strict']) && process.env.CCX_ALLOW_CONFIG !== '1' && isGuardrail(filePath)) {
    deny(guardrailMsg(filePath));
  }

  // 2. Fact-forcing — `strict` uniquement, une seule fois par fichier et par session.
  if (!enabled(['strict'])) return;
  const seen = readState(input.session_id, 'touched', {});
  if (seen[filePath]) return;
  seen[filePath] = 1;
  // Marqué AVANT le refus : le second passage doit aboutir, sinon on boucle.
  writeState(input.session_id, 'touched', seen);
  const isNew = input.tool_name === 'Write' && !require('fs').existsSync(filePath);
  deny(factMsg(filePath, isNew));
}

module.exports = { run, isGuardrail };
