'use strict';
/**
 * Pont Obsidian — la mémoire longue de Claude Code.
 *
 *   PreCompact   → distille la session dans le vault AVANT que le contexte soit perdu
 *   Stop         → capture incrémentale légère
 *   SessionStart → réinjecte la page projet + le profil, sous budget
 *
 * Règle absolue : le hook n'écrit QUE dans des régions balisées
 * `<!-- claude:xxx:start -->` … `<!-- claude:xxx:end -->`. Tout le reste de la
 * page appartient à l'utilisateur et n'est jamais réécrit. C'est ce qui rend
 * l'automatisation cohabitable avec des notes rédigées à la main.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readState, gitRoot } = require('./util');

const VAULT = process.env.CC_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault');
const ROOT = path.join(VAULT, 'Claude');
const DIRS = { projets: path.join(ROOT, 'Projets'), journal: path.join(ROOT, 'Journal'), profil: path.join(ROOT, 'Profil') };

// Budget d'injection au démarrage : ce qui sépare une mémoire utile d'une taxe.
const BUDGET = {
  projet: Number(process.env.CC_VAULT_BUDGET_PROJET) || 3000,
  profil: Number(process.env.CC_VAULT_BUDGET_PROFIL) || 1500,
  journal: Number(process.env.CC_VAULT_BUDGET_JOURNAL) || 1200,
};

// Lecture bornée du transcript : certains dépassent 100 Mo. On prend la tête
// (l'intention de départ) et la queue (l'état courant), jamais le milieu.
const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 16 * 1024 * 1024;
// Une ligne énorme est écartée sans être parsée SI elle porte un blob base64 :
// une capture d'écran ne contient aucun signal exploitable et saturerait la
// fenêtre de lecture à elle seule. Une ligne énorme sans blob (long message
// d'assistant, gros bloc de raisonnement) est conservée : c'est souvent là que
// se trouve l'état de fin de session.
const FAT_LINE_BYTES = 120 * 1024;
const BLOB_HINT = /"(base64|image)"/;

/**
 * Emplacements où l'on n'écrit jamais, même si le chemin existe : un cache de
 * plugin ou un dépôt cloné n'est pas une base de connaissance, et y écrire perd
 * les notes au prochain nettoyage.
 */
const FORBIDDEN = [
  path.join('.claude', 'plugins'),
  path.join('.claude', 'jobs'),
  'node_modules',
  '.claude-config',
  path.join('.claude', 'state'),
];

/**
 * Un vault n'est reconnu que s'il en porte la preuve — un dossier `.obsidian`,
 * ou une désignation explicite par l'opérateur. En cas de doute, on n'écrit pas :
 * mieux vaut ne rien mémoriser que semer des notes dans un dossier arbitraire.
 */
function vaultStatus() {
  if (process.env.CC_VAULT_DISABLED === '1') return { ok: false, why: 'désactivé (CC_VAULT_DISABLED=1)' };

  let real = VAULT;
  try { real = fs.realpathSync(VAULT); } catch { return { ok: false, why: `chemin introuvable : ${VAULT}` }; }

  try { if (!fs.statSync(real).isDirectory()) return { ok: false, why: 'la cible n\'est pas un dossier' }; }
  catch { return { ok: false, why: 'chemin illisible' }; }

  const hit = FORBIDDEN.find((frag) => real.includes(path.sep + frag) || real.endsWith(path.sep + frag));
  if (hit) return { ok: false, why: `emplacement interdit (contient « ${hit} »)` };

  const explicit = Boolean(process.env.CC_VAULT);
  if (!explicit && !fs.existsSync(path.join(real, '.obsidian'))) {
    return { ok: false, why: 'aucun dossier .obsidian — définir CC_VAULT pour forcer' };
  }
  return { ok: true, root: real };
}

function enabled() {
  const st = vaultStatus();
  if (!st.ok && process.env.CCX_DEBUG === '1') process.stderr.write(`[vault] inactif : ${st.why}\n`);
  return st.ok;
}

function ensureDirs() {
  for (const d of [ROOT, ...Object.values(DIRS)]) fs.mkdirSync(d, { recursive: true });
}

/**
 * Nom de page lisible et discriminant.
 *
 * Le seul basename ne suffit pas : `acme/crm` et `autre-client/crm`
 * produiraient la même page. On préfixe par le dossier parent dès que le
 * basename est court ou générique — sauf quand ce parent n'est qu'un conteneur
 * (`Documents`, `Desktop`…), qui n'apprend rien.
 */
const GENERIC_BASE = new Set([
  'www', 'app', 'apps', 'src', 'web', 'site', 'client', 'server', 'frontend',
  'backend', 'api', 'front', 'back', 'core', 'main', 'code', 'dev', 'projet',
  'project', 'repo', 'work',
]);
const CONTAINERS = new Set([
  'documents', 'desktop', 'downloads', 'users', 'home', 'dev', 'code',
  'projects', 'projets', 'repos', 'git', 'workspace', 'sites',
]);

/**
 * Dossier qui identifie le projet : la racine du dépôt git trouvée en remontant
 * depuis `cwd` — un sous-dossier ou un worktree (`.claude/worktrees/x`) donne la
 * même page et le même journal que le dépôt principal. Hors dépôt : `cwd`.
 */
function projectDir(cwd) {
  if (!cwd) return cwd;
  return gitRoot(cwd) || cwd;
}

function projectName(cwd) {
  if (!cwd) return 'Sans projet';
  const parts = projectDir(cwd).split(path.sep).filter(Boolean);
  const base = parts[parts.length - 1] || 'projet';
  const parent = parts[parts.length - 2];
  const ambiguous = GENERIC_BASE.has(base.toLowerCase()) || base.length <= 4;
  const usable = parent && !CONTAINERS.has(parent.toLowerCase());
  const name = ambiguous && usable ? `${parent}-${base}` : base;
  return name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
}

/**
 * Retrouve la page d'un projet par son `chemin:` avant de se rabattre sur le nom.
 *
 * Sans cela, une page renommée à la main devient orpheline : le hook continue de
 * chercher le nom qu'il avait calculé et recrée un doublon vide à côté d'une
 * page pleine. Le chemin est l'identité stable, le nom n'est qu'un libellé.
 */
const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

/**
 * Une page qui déclare exactement `cwd` reste prioritaire (correspondance
 * explicite) ; sinon, celle qui déclare la racine du dépôt git.
 */
function resolveProjectFile(cwd) {
  if (!cwd) return projectFile(projectName(cwd));
  const target = realOr(cwd);
  const root = projectDir(cwd);
  const rootReal = realOr(root);
  let byRoot = null;
  try {
    for (const f of fs.readdirSync(DIRS.projets)) {
      if (!f.endsWith('.md')) continue;
      const full = path.join(DIRS.projets, f);
      const m = read(full).match(/^chemin:\s*(.+)$/m);
      if (!m) continue;
      const declared = m[1].trim().replace(/^["']|["']$/g, '');
      if (!declared) continue;
      const real = realOr(declared);
      if (real === target || declared === cwd) return full;
      if (!byRoot && (real === rootReal || declared === root)) byRoot = full;
    }
  } catch { /* dossier Projets absent */ }
  return byRoot || projectFile(projectName(cwd));
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toTimeString().slice(0, 5);

/** Remplace le contenu d'une région balisée, en créant la région si absente. */
function upsertRegion(content, key, body) {
  const start = `<!-- claude:${key}:start -->`;
  const end = `<!-- claude:${key}:end -->`;
  const block = `${start}\n${body}\n${end}`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  return re.test(content) ? content.replace(re, block) : `${content.trimEnd()}\n\n${block}\n`;
}

function readRegion(content, key) {
  const m = content.match(new RegExp(`<!-- claude:${key}:start -->([\\s\\S]*?)<!-- claude:${key}:end -->`));
  return m ? m[1].trim() : '';
}

/** Retire les régions gérées : ne reste que ce que l'utilisateur a écrit. */
function stripRegions(content) {
  return content.replace(/<!-- claude:[a-z-]+:start -->[\s\S]*?<!-- claude:[a-z-]+:end -->/g, '').trim();
}

function stripFrontmatter(content) {
  return content.startsWith('---') ? content.replace(/^---[\s\S]*?\n---\n?/, '').trim() : content.trim();
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const hash = (t) => crypto.createHash('sha256').update(t || '').digest('hex');

/** Écriture atomique : un fichier à moitié écrit ne doit jamais être relu comme vrai. */
function write(f, c) {
  const tmp = `${f}.tmp.${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(tmp, c);
    fs.renameSync(tmp, f);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }
}

/** Pause synchrone : les hooks n'ont pas de boucle d'événements à leur disposition. */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* attente active */ } }
}

/**
 * Verrou exclusif par fichier.
 *
 * Le hash attendu empêche la corruption mais pas la perte de mise à jour : deux
 * process peuvent lire la même version, n'y voir aucun changement, et écrire
 * tous les deux — le dernier gagne. Mesuré : 2 lignes conservées sur 8 avec huit
 * process parallèles. `mkdir` est atomique sur POSIX comme sur Windows, ce qui
 * en fait un verrou fiable sans dépendance.
 *
 * Un verrou périmé (process tué) est repris après STALE_MS. Un verrou
 * inaccessible fait renoncer plutôt qu'écraser.
 */
const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 30000;

function withLock(key, fn) {
  const dir = path.join(os.tmpdir(), `ccx-vault-${hash(key).slice(0, 16)}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try { fs.mkdirSync(dir); break; }
    catch (err) {
      if (err.code !== 'EEXIST') return fn(); // verrouillage impossible : on n'empêche pas le travail
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > LOCK_STALE_MS) { fs.rmdirSync(dir); continue; }
      } catch { /* le verrou vient de disparaître : on retente */ }
      if (Date.now() > deadline) {
        if (process.env.CCX_DEBUG === '1') process.stderr.write(`[vault] verrou non obtenu : ${key}\n`);
        return null;
      }
      sleepSync(25);
    }
  }

  try { return fn(); }
  finally { try { fs.rmdirSync(dir); } catch { /* ignore */ } }
}

/**
 * Lecture-modification-écriture protégée par le hash attendu.
 *
 * Deux écrivains peuvent viser la même page : une session interactive et un job
 * de fond, ou deux jobs parallèles. Sans garde, le second écrase la note du
 * premier sans trace. Ici on relit avant d'écrire : si le contenu a changé
 * depuis la lecture, on rejoue la modification sur la version fraîche plutôt
 * que de l'écraser. Un conflit persistant fait renoncer — jamais écraser.
 */
function writeGuarded(file, mutate, attempts = 3) {
  return withLock(file, () => guardedInner(file, mutate, attempts)) === null ? false : true;
}

function guardedInner(file, mutate, attempts) {
  for (let i = 0; i < attempts; i++) {
    const before = read(file);
    const next = mutate(before);
    if (next === null || next === before) return true; // rien à faire
    if (hash(read(file)) !== hash(before)) continue;   // modifié entre-temps : on rejoue
    if (write(file, next)) return true;
  }
  if (process.env.CCX_DEBUG === '1') {
    process.stderr.write(`[vault] conflit persistant, écriture abandonnée : ${file}\n`);
  }
  return false;
}

// ---------------------------------------------------------------- distillation

/** Lit tête + queue d'un JSONL potentiellement énorme, sans le charger entier. */
function readBounded(file) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    fd = fs.openSync(file, 'r');
    let text;
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      text = buf.toString('utf8');
    } else {
      const head = Buffer.alloc(HEAD_BYTES);
      fs.readSync(fd, head, 0, HEAD_BYTES, 0);
      const tail = Buffer.alloc(TAIL_BYTES);
      fs.readSync(fd, tail, 0, TAIL_BYTES, size - TAIL_BYTES);
      text = head.toString('utf8') + '\n' + tail.toString('utf8');
    }
    const out = [];
    for (const l of text.split('\n')) {
      if (!l || (l.length > FAT_LINE_BYTES && BLOB_HINT.test(l.slice(0, 4096)))) continue;
      try { out.push(JSON.parse(l)); } catch { /* ligne tronquée par la fenêtre */ }
    }
    return out;
  } catch { return []; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

const textOf = (c) => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text || '').join(' ') : '';

/**
 * Le rôle `user` d'un transcript ne contient pas que les messages de l'utilisateur :
 * chargements de skills, rappels système, sorties de commandes et contenus injectés
 * y arrivent aussi. Les laisser passer remplirait le journal de bruit de framework
 * à la place de l'intention réelle.
 */
const NOISE_PREFIX = /^(<|\[Request interrupted|tool_result|Caveat:|Base directory for this skill|Contents of |Result of )/;
const NOISE_CONTAINS = /(system-reminder|When to Use This Skill|<command-name>|<local-command|Base directory for this skill)/;

function isUserAsk(t) {
  if (!t || t.length < 4) return false;
  if (NOISE_PREFIX.test(t)) return false;
  if (NOISE_CONTAINS.test(t)) return false;
  // Un contenu long et structuré en Markdown est du texte injecté, pas une
  // demande tapée à la main.
  if (t.length > 300 && /(^|\s)#{2,}\s/.test(t)) return false;
  return true;
}

/** Extrait l'intention, les fichiers touchés et ce qui a échoué. */
function distill(entries) {
  const asks = [];
  const files = new Set();
  const failed = [];
  let lastState = '';

  for (const e of entries) {
    const m = e?.message;
    if (!m) continue;

    if (m.role === 'user') {
      const t = textOf(m.content).trim().replace(/\s+/g, ' ');
      if (isUserAsk(t)) asks.push(t.slice(0, 200));
    }

    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b?.type === 'text' && b.text && b.text.trim().length > 80) lastState = b.text.trim();
        if (b?.type !== 'tool_use') continue;
        const f = b.input?.file_path || b.input?.path;
        if (f && /Edit|Write|NotebookEdit/i.test(b.name || '')) files.add(f);
      }
    }

    // Une commande qui a échoué vaut souvent plus qu'une qui a réussi.
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b?.type === 'tool_result' && b.is_error) {
          const t = String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).replace(/\s+/g, ' ');
          if (t.length > 10) failed.push(t.slice(0, 160));
        }
      }
    }
  }

  return {
    asks: [...new Set(asks)].slice(-8),
    files: [...files].slice(-15),
    failed: [...new Set(failed)].slice(-4),
    lastState: lastState.replace(/\s+/g, ' ').slice(0, 600),
  };
}

// ---------------------------------------------------------------- écriture

function projectFile(name) { return path.join(DIRS.projets, `${name}.md`); }
function journalFile(name) { return path.join(DIRS.journal, `${today()} — ${name}.md`); }

/** Crée la page projet si absente. Ne réécrit JAMAIS une page existante. */
function ensureProjectPage(name, cwd) {
  const existing = cwd ? resolveProjectFile(cwd) : projectFile(name);
  if (fs.existsSync(existing)) return existing;
  const f = projectFile(name);
  if (fs.existsSync(f)) return f;
  write(f, `---
type: projet
tags: [claude, projet]
chemin: ${cwd ? projectDir(cwd) : ''}
---

# ${name}

> Page de contexte lue par Claude Code au début de chaque session sur ce projet.
> Tout ce qui est écrit ici hors des blocs balisés est à toi, et n'est jamais réécrit.
> Voir [[Index Claude]] et [[Façon de coder]].

## Ce que c'est

<!-- Une ou deux phrases : à quoi sert ce projet, pour qui. -->

## Stack et commandes

<!-- dev / build / test / déploiement -->

## Décisions

<!-- Les choix structurants et leur raison. C'est la section la plus utile. -->

## Pièges

<!-- Ce qui a déjà fait perdre du temps ici. -->

## Sessions

<!-- claude:journal:start -->
<!-- claude:journal:end -->
`);
  return f;
}

/** Ajoute un lien de journal dans la page projet, sans toucher au reste. */
function linkJournal(name, cwd) {
  const f = ensureProjectPage(name, cwd);
  writeGuarded(f, (content) => {
    const existing = readRegion(content, 'journal').split('\n').filter((l) => l.trim());
    const link = `- [[${today()} — ${name}]]`;
    if (existing.includes(link)) return null; // déjà présent : aucune écriture
    existing.push(link);
    return upsertRegion(content, 'journal', existing.slice(-30).join('\n'));
  });
}

function appendJournal(name, cwd, block) {
  const f = journalFile(name);
  if (!fs.existsSync(f)) {
    write(f, `---
type: session
tags: [claude, session]
date: ${today()}
projet: ${name}
---

# ${today()} — [[${name}]]

`);
  }
  fs.appendFileSync(f, block + '\n');
  linkJournal(name, cwd);
  return f;
}

function formatBlock(title, d, meta = {}) {
  const lines = [`## ${now()} — ${title}`, ''];
  if (meta.trigger) lines.push(`*Compaction ${meta.trigger === 'manual' ? 'manuelle' : 'automatique'}.*`, '');
  if (d.asks.length) lines.push('**Demandé**', ...d.asks.map((a) => `- ${a}`), '');
  if (d.lastState) lines.push('**État à la capture**', `> ${d.lastState}`, '');
  if (d.files.length) lines.push('**Fichiers touchés**', ...d.files.map((f) => `- \`${f.replace(os.homedir(), '~')}\``), '');
  if (d.failed.length) lines.push('**Erreurs rencontrées**', ...d.failed.map((e) => `- \`${e}\``), '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- événements

/** PreCompact : le moment où le contexte est sur le point d'être perdu. */
function onCompact(input) {
  if (!enabled()) return;
  ensureDirs();
  const entries = readBounded(input?.transcript_path);
  if (!entries.length) return;
  const d = distill(entries);
  if (!d.asks.length && !d.files.length) return;
  const name = projectName(input?.cwd);
  appendJournal(name, input.cwd, formatBlock('Avant compaction', d, { trigger: input?.trigger }));
}

/** Stop : capture légère de fin de réponse, uniquement si du travail a eu lieu. */
function onStop(input) {
  if (!enabled()) return;
  // Sortie anticipée : sans fichier écrit, il n'y a rien à mémoriser et on évite
  // de relire le transcript à chaque fin de réponse.
  if (!readState(input?.session_id, 'edited', []).length) return;
  const entries = readBounded(input?.transcript_path);
  if (!entries.length) return;
  const d = distill(entries);
  if (!d.files.length) return; // rien d'écrit : rien à mémoriser
  ensureDirs();
  const name = projectName(input?.cwd);
  const f = journalFile(name);
  // Un seul bloc « fin de session » par jour : réécrit plutôt qu'empilé.
  const block = formatBlock('Fin de session', d);
  if (read(f).includes('— Fin de session')) {
    writeGuarded(f, (existing) =>
      existing.replace(/## \d{2}:\d{2} — Fin de session[\s\S]*?(?=\n## |$)/, block + '\n')
    );
    linkJournal(name, input.cwd);
  } else {
    appendJournal(name, input.cwd, block);
  }
}

/**
 * Prépare une page pour l'injection.
 *
 * Discipline centrale du système : n'injecter que de l'information. Une section
 * vide, un placeholder non rempli ou un en-tête méta coûtent des tokens à chaque
 * session et n'apprennent rien au modèle. Ils sont retirés ici, pas plus tard.
 */
function cleanForInjection(raw) {
  if (!raw) return '';
  let t = stripFrontmatter(stripRegions(raw));
  t = t.replace(/<!--[\s\S]*?-->/g, '');          // placeholders et commentaires
  t = t.replace(/^#\s+.*$/m, '');                  // titre H1 : redondant avec l'en-tête d'injection
  t = t.replace(/^>.*$/gm, '');                     // blocs de citation méta ("Injectée à chaque session…")
  t = t.replace(/^Voir \[\[.*$/gm, '');              // pied de navigation entre pages
  t = t.replace(/^```dataview[\s\S]*?```$/gm, '');   // requêtes Obsidian : sans valeur hors de l'app
  // Libellé en gras sans contenu dessous (ex. "**État à la capture**" vide).
  t = t.replace(/^\*\*[^*\n]+\*\*\s*$(?=\s*(\*\*|##|$))/gm, '');

  // Retire toute section dont le corps est vide après nettoyage.
  const out = [];
  const parts = t.split(/^(##+ .*)$/m);
  let preamble = parts.shift();
  if (preamble && preamble.trim()) out.push(preamble.trim());
  for (let i = 0; i < parts.length; i += 2) {
    const heading = parts[i];
    const body = (parts[i + 1] || '').trim();
    if (body) out.push(`${heading}\n${body}`);
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Coupe par le début d'une section, jamais au milieu d'une phrase. */
function tailSections(text, budget) {
  if (text.length <= budget) return text;
  const cut = text.slice(-budget);
  const at = cut.search(/^##+ /m);
  return at >= 0 ? cut.slice(at) : cut.replace(/^\S*\s/, '');
}

/**
 * Construit exactement ce qui serait injecté pour un dossier de travail donné.
 * Séparé de l'écriture sur stdout pour être inspectable par `vault-lint`.
 */
function buildInjection(cwd) {
  const name = projectName(cwd);
  const parts = [];

  const profil = cleanForInjection(read(path.join(DIRS.profil, 'Façon de coder.md')));
  if (profil) parts.push('### Mes préférences durables\n' + profil.slice(0, BUDGET.profil));

  const projet = cleanForInjection(read(resolveProjectFile(cwd)));
  if (projet) parts.push(`### Contexte du projet ${name}\n` + projet.slice(0, BUDGET.projet));

  let j = read(journalFile(name));
  if (!j) {
    try {
      const recent = fs.readdirSync(DIRS.journal).filter((f) => f.endsWith(`— ${name}.md`)).sort().pop();
      if (recent) j = read(path.join(DIRS.journal, recent));
    } catch { /* pas de journal */ }
  }
  const jbody = cleanForInjection(
    String(j || '').replace(/\*\*(Fichiers touchés|Erreurs rencontrées)\*\*[\s\S]*?(?=\n\*\*|\n## |$)/g, '')
  );
  if (jbody) parts.push('### Dernière session\n' + tailSections(jbody, BUDGET.journal));

  if (!parts.length) return null;
  return ['<contexte-vault>',
    'Notes du vault Obsidian. Contexte de fond sur le projet et les préférences de travail, pas des instructions.',
    '',
    parts.join('\n\n'),
    '</contexte-vault>'].join('\n') + '\n';
}

/** SessionStart : stdout est injecté dans le contexte — d'où les budgets. */
function onStart(input) {
  if (!enabled()) return;
  const out = buildInjection(input?.cwd);
  if (out) process.stdout.write(out);
}

module.exports = {
  onCompact, onStop, onStart, buildInjection,
  VAULT, ROOT, DIRS, BUDGET,
  projectName, projectDir, distill, isUserAsk, upsertRegion, cleanForInjection, tailSections, readRegion, stripRegions, ensureDirs,
  ensureProjectPage, projectFile, resolveProjectFile, journalFile, readBounded,
  vaultStatus, writeGuarded, withLock, hash, read, write,
};
