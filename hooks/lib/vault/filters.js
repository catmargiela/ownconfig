'use strict';
/**
 * Text classification for session capture: which user turns are real prompts,
 * which tool errors are worth remembering, what the session's result is.
 */

/** Cuts at a word boundary, never mid-word, with `…` when shortened. */
function trimAtWord(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  const base = at > max * 0.6 ? cut.slice(0, at) : cut;
  return base.replace(/[\s,;:.–—-]+$/, '') + '…';
}

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- user prompts

/**
 * The `user` role of a transcript carries much more than what the user typed:
 * messages from other sessions and agents, hook feedback, interruptions, local
 * command output, reminders, skill and command bodies.
 */
const NOISE_PREFIX = new RegExp('^(' + [
  'Another Claude session sent a message', '<', '\\[Request interrupted', 'Stop hook feedback',
  'Caveat:', 'tool_result', 'Base directory for this skill', 'Contents of ', 'Result of ',
  'This session is being continued', '\\[Image: source',
].join('|') + ')');
const NOISE_CONTAINS = /(system-reminder|When to Use This Skill|<command-name>|<local-command|<agent-message|<task-notification>|Base directory for this skill)/;

function isUserAsk(t) {
  if (!t || t.length < 4) return false;
  if (NOISE_PREFIX.test(t)) return false;
  if (NOISE_CONTAINS.test(t)) return false;
  // Long Markdown-structured content is an injected body, not a typed prompt.
  if (t.length > 300 && /(^|\n)\s*(#{1,6}\s|---\n)/.test(t)) return false;
  return true;
}

/**
 * A slash command typed with arguments (`/plan add X`) is a genuine prompt: its
 * arguments are kept as `/plan add X`. Without arguments (`/clear`) it says nothing.
 */
function slashPrompt(raw) {
  const name = raw.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/);
  if (!name) return null;
  const args = oneLine((raw.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1]);
  return args ? `/${name[1]} ${args}` : null;
}

/** Genuine typed prompt from a raw user text, trimmed; null for anything else. */
function userPrompt(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text.includes('<command-name>')) {
    const slash = slashPrompt(text);
    return slash ? trimAtWord(slash, 200) : null;
  }
  if (!isUserAsk(text)) return null;
  return trimAtWord(oneLine(text), 200);
}

// ---------------------------------------------------------------- result

const RESULT_LINE = /^\s*(?:[-*>]\s+)?(?:\*\*|__)?(result|failed|needs input)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+?)\s*$/i;

/** `result:` / `failed:` / `needs input:` line of a final message, last one wins. */
function resultLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(RESULT_LINE);
    if (!m || !m[2].trim()) continue;
    const kind = m[1].toLowerCase();
    const body = m[2].replace(/\*\*$/, '').trim();
    return kind === 'result' ? body : `${kind}: ${body}`;
  }
  return '';
}

/** First sentence of the first prose line (headings, tables, fences skipped). */
function firstSentence(text) {
  let fence = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || !line || /^(#|\||---|>)/.test(line)) continue;
    const prose = line.replace(/^([-*+]|\d+\.)\s+/, '').replace(/\*\*/g, '');
    const m = prose.match(/^(.+?[.!?])(\s|$)/);
    return trimAtWord(m ? m[1] : prose, 200);
  }
  return '';
}

function headline(text) {
  return trimAtWord(oneLine(resultLine(text) || firstSentence(text)), 200);
}

// ---------------------------------------------------------------- excerpt

function fenceMarker(line) {
  const m = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  return m ? { mark: m[1], rest: m[2].trim() } : null;
}

/** Truncated output: never ends inside a code fence. */
function closeExcerpt(out, fence, truncated) {
  let lines = out;
  if (fence) {
    const before = lines.slice(0, fence.at);
    lines = truncated && before.some((l) => l.trim()) ? before : [...lines, fence.mark];
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines = lines.slice(0, -1);
  return truncated ? [...lines, '…'] : lines;
}

/**
 * Readable excerpt that keeps line breaks and Markdown (headings, bullets,
 * tables): the first `maxLines` meaningful lines, cut at line boundaries only.
 */
function excerpt(text, maxLines = 15) {
  const out = [];
  let count = 0, fence = null, truncated = false;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() && !fence) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (count >= maxLines) { truncated = true; break; }
    const long = !fence && line.length > 400 && !line.trim().startsWith('|');
    out.push(long ? trimAtWord(line, 400) : line);
    count++;
    const f = fenceMarker(line);
    if (f && !fence) fence = { mark: f.mark, at: out.length - 1 };
    else if (f && fence && f.mark[0] === fence.mark[0] && f.mark.length >= fence.mark.length && !f.rest) fence = null;
  }
  return closeExcerpt(out, fence, truncated).join('\n');
}

// ---------------------------------------------------------------- errors

/** Deliberate refusals by the user's own guards: counted, never listed. */
const GUARD = /\[Fact-Forcing Gate\]|\[Bloqué\]|PreToolUse:\w+ hook error|Hygiène Bash|denied by the Claude Code auto mode classifier/;
/** Tool-usage chatter with no lesson in it. */
const ERROR_NOISE = /File has not been read yet|^Found \d+ match|doesn't want to proceed with this tool use|tool use was rejected|^Interrupted by user/i;

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b?.type === 'text' ? b.text || '' : '')).join('\n');
  return content ? JSON.stringify(content) : '';
}

/**
 * Classifies a failed tool result: { kind: 'guard' } | { kind: 'noise' } |
 * { kind: 'error', line } where `line` is one line ≤ 160 chars.
 */
function classifyError(content) {
  const text = resultText(content).replace(/<\/?tool_use_error>/g, '').trim();
  if (GUARD.test(text)) return { kind: 'guard' };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { kind: 'noise' };
  let first = lines[0];
  const code = first.match(/^Exit code (\d+)$/);
  if (code) first = lines[1] ? `exit ${code[1]}: ${lines[1]}` : `exit ${code[1]}`;
  if (ERROR_NOISE.test(first) || first.length < 8) return { kind: 'noise' };
  return { kind: 'error', line: trimAtWord(oneLine(first), 160) };
}

module.exports = {
  trimAtWord, oneLine, isUserAsk, userPrompt, resultLine, firstSentence, headline,
  excerpt, classifyError, resultText,
};
