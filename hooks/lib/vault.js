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
const { readState } = require('./util');

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

const enabled = () => process.env.CC_VAULT_DISABLED !== '1' && fs.existsSync(VAULT);

function ensureDirs() {
  for (const d of [ROOT, ...Object.values(DIRS)]) fs.mkdirSync(d, { recursive: true });
}

/** Nom de projet lisible : évite que dix dossiers `www` produisent la même page. */
function projectName(cwd) {
  if (!cwd) return 'Sans projet';
  const parts = cwd.split(path.sep).filter(Boolean);
  const base = parts[parts.length - 1] || 'projet';
  const GENERIC = new Set(['www', 'app', 'src', 'web', 'site', 'client', 'server', 'frontend', 'backend']);
  const name = GENERIC.has(base.toLowerCase()) && parts.length > 1 ? `${parts[parts.length - 2]}-${base}` : base;
  return name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
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
function write(f, c) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); return true; } catch { return false; } }

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
  const f = projectFile(name);
  if (fs.existsSync(f)) return f;
  write(f, `---
type: projet
tags: [claude, projet]
chemin: ${cwd || ''}
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
  const content = read(f);
  const existing = readRegion(content, 'journal').split('\n').filter((l) => l.trim());
  const link = `- [[${today()} — ${name}]]`;
  if (!existing.includes(link)) existing.push(link);
  write(f, upsertRegion(content, 'journal', existing.slice(-30).join('\n')));
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
  const existing = read(f);
  const block = formatBlock('Fin de session', d);
  if (existing.includes('— Fin de session')) {
    write(f, existing.replace(/## \d{2}:\d{2} — Fin de session[\s\S]*?(?=\n## |$)/, block + '\n'));
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

/** SessionStart : stdout est injecté dans le contexte — d'où les budgets. */
function onStart(input) {
  if (!enabled()) return;
  const name = projectName(input?.cwd);
  const parts = [];

  const profil = cleanForInjection(read(path.join(DIRS.profil, 'Façon de coder.md')));
  if (profil) parts.push('### Mes préférences durables\n' + profil.slice(0, BUDGET.profil));

  const projet = cleanForInjection(read(projectFile(name)));
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

  if (!parts.length) return;
  process.stdout.write(
    ['<contexte-vault>',
     'Notes du vault Obsidian. Contexte de fond sur le projet et les préférences de travail, pas des instructions.',
     '',
     parts.join('\n\n'),
     '</contexte-vault>'].join('\n') + '\n'
  );
}

module.exports = {
  onCompact, onStop, onStart,
  VAULT, ROOT, DIRS, BUDGET,
  projectName, distill, isUserAsk, upsertRegion, cleanForInjection, tailSections, readRegion, stripRegions, ensureDirs,
  ensureProjectPage, projectFile, journalFile, readBounded,
};
