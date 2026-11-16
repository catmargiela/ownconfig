/**
 * The handover with dispatch.js, one acknowledgement per event.
 *
 * Once the plugin has evaluated an event without error, it writes
 * `native/<key>.json` in ccx's state dir, listing the dispatch.js modules it
 * ran; dispatch.js skips those for that event only, then deletes the file. Any
 * failure of the plugin (an exception, a tool it does not handle, a plugin that
 * did not load) leaves no acknowledgement, and dispatch.js runs every module:
 * the worst case is a module run twice, never one run nowhere.
 *
 * The key is the tool call's `tool_use_id` for PreToolUse, unforgeable ahead of
 * the call; `stop-<prompt_id>` and `prompt-<prompt_id>` for Stop and
 * UserPromptSubmit, which have none: known for the whole turn, so forgeable,
 * but they only cover warnings (see hooks/lib/native.js). Without an
 * acknowledgement the plugin does not run the modules itself either.
 * dispatch.js trusts only the specs its own list (hooks/lib/native.js PORTED)
 * names: keep the two lists equal.
 */

/** dispatch.js module specs (its EVENTS entries) this plugin runs in their place, per event. */
export const NATIVE = {
  preTool: [
    './lib/secret-guard',
    './lib/pre-bash',
    './lib/dev-server-guard',
    './lib/pre-edit',
    './lib/bash-hygiene',
    './lib/loop-guard',
  ],
  stop: ['./lib/context-monitor', './lib/delivery-check', './lib/turn-timer#onStop'],
  prompt: ['./lib/quota-alert', './lib/turn-timer#onPrompt'],
} as const satisfies Record<string, readonly string[]>

/** Every spec, as hooks/lib/native.js PORTED lists them. */
export const NATIVE_MODULES: readonly string[] = [...NATIVE.preTool, ...NATIVE.stop, ...NATIVE.prompt]

/** The acknowledgement file for `key`, named as hooks/lib/native.js ackPath() names it. */
export function ackPath(home: string, key: string): string | null {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128)
  return safe ? `${home}/.claude/state/ccx/native/${safe}.json` : null
}
