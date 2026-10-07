/**
 * pre-edit, ported from ccx (hooks/lib/pre-edit.js):
 *  1. config protection (standard, strict): refuse to weaken a linter,
 *     formatter or typechecker config;
 *  2. fact-forcing (strict): refuse the first write to each file until the
 *     facts around it are stated.
 */
import { tilde } from '../config'

/** Files whose change would weaken a guarantee rather than fix the code. */
const GUARDRAIL_FILES: readonly RegExp[] = [
  /^\.eslintrc(\..*)?$/i, /^eslint\.config\.[cm]?[jt]s$/i,
  /^\.prettierrc(\..*)?$/i, /^prettier\.config\.[cm]?[jt]s$/i,
  /^biome\.jsonc?$/i,
  /^tsconfig(\..+)?\.json$/i,
  /^\.ruff\.toml$/i, /^ruff\.toml$/i, /^mypy\.ini$/i, /^\.flake8$/i,
  /^\.editorconfig$/i,
]

/** Last path segment, as Node's `path.basename` gives it for a POSIX path. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

export function isGuardrail(filePath: string): boolean {
  const name = basename(filePath || '')
  return GUARDRAIL_FILES.some(re => re.test(name))
}

export function guardrailMsg(filePath: string, home: string): string {
  return [
    '[Guardrail Protection] Modification refusée : ' + tilde(filePath, home),
    '',
    "Ce fichier définit une garantie (lint / format / types). L'assouplir fait",
    'disparaître le symptôme, pas le défaut.',
    '',
    '  → Corriger le code qui viole la règle.',
    "  → Si la règle est réellement inadaptée, l'expliquer à l'utilisateur et",
    '    demander son accord avant de toucher à ce fichier.',
    '',
    'Contournement explicite (à ne poser que sur demande) : CCX_ALLOW_CONFIG=1',
  ].join('\n')
}

export function factMsg(filePath: string, isNew: boolean, home: string): string {
  const body = isNew
    ? [
        '1. Nommer le(s) fichier(s) et la ligne qui appelleront ce nouveau fichier',
        "2. Confirmer, recherche à l'appui (Glob/Grep), qu'aucun fichier existant ne remplit déjà ce rôle",
      ]
    : [
        "1. Lister TOUS les fichiers qui importent celui-ci (Glob/Grep sur l'arborescence)",
        '2. Lister les fonctions/classes publiques que ce changement affecte',
      ]
  return [
    '[Fact-Forcing Gate] ' + (isNew ? 'Avant de créer ' : 'Avant de modifier ') + tilde(filePath, home) + ', énoncer ces faits :',
    '',
    ...body,
    '3. Si le fichier lit ou écrit des données : nommer les champs et le format',
    "4. Citer mot pour mot l'instruction en cours de l'utilisateur",
    '',
    'Énoncer les faits, puis relancer la même opération (elle passera).',
    'Désactiver ce gate : CC_PROFILE=standard',
  ].join('\n')
}
