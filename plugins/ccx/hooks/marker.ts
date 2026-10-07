/**
 * The handover with dispatch.js, one acknowledgement per tool call.
 *
 * Once the plugin has evaluated a call without error and let it through, it
 * writes `native/<tool_use_id>.json` in ccx's state dir, listing the modules it
 * ran; dispatch.js skips those for that call only, then deletes the file. Any
 * failure of the plugin (an exception, a tool it does not handle, a plugin that
 * did not load) leaves no acknowledgement, and dispatch.js runs every gate: the
 * worst case is a gate run twice, never a gate run nowhere. A tool_use_id is
 * random and assigned after the call is made, so none can be forged ahead.
 *
 * dispatch.js trusts only the ids its own list (hooks/lib/native.js PORTED)
 * names: keep the two lists equal.
 */

/** dispatch.js module ids (its EVENTS entries) this plugin runs in their place. */
export const NATIVE_MODULES: readonly string[] = [
  './lib/secret-guard',
  './lib/pre-bash',
  './lib/dev-server-guard',
  './lib/pre-edit',
  './lib/bash-hygiene',
  './lib/loop-guard',
]

/** The acknowledgement for one call, named as hooks/lib/native.js ackPath() names it. */
export function ackPath(home: string, toolUseId: string): string | null {
  const safe = toolUseId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128)
  return safe ? `${home}/.claude/state/ccx/native/${safe}.json` : null
}
