/** Profile gating and environment switches, as ccx's util.js reads them. */

export type Profile = 'minimal' | 'standard' | 'strict'

const PROFILES: readonly Profile[] = ['minimal', 'standard', 'strict']

export const ALL: readonly Profile[] = PROFILES
export const STANDARD_UP: readonly Profile[] = ['standard', 'strict']
export const STRICT: readonly Profile[] = ['strict']

/** Raw environment values, as `$.env.get` answers them. */
export type Env = {
  profile?: string
  disabled?: string
  allowConfig?: string
  loopGuard?: string
  home?: string
}

export type Flags = {
  profile: Profile
  isDisabled: boolean
  isConfigAllowed: boolean
  isLoopGuardOff: boolean
  home: string
}

/** An invalid or missing `CC_PROFILE` falls back to `standard`. */
export function toProfile(raw: string | undefined): Profile {
  const value = String(raw ?? 'standard').trim().toLowerCase()
  return PROFILES.find(p => p === value) ?? 'standard'
}

export function toFlags(env: Env): Flags {
  return {
    profile: toProfile(env.profile),
    isDisabled: env.disabled === '1',
    isConfigAllowed: env.allowConfig === '1',
    isLoopGuardOff: String(env.loopGuard ?? '').trim().toLowerCase() === 'off',
    home: env.home ?? '',
  }
}

/** A rule runs when ccx is not disabled and the active profile is listed. */
export function isOn(flags: Flags, profiles: readonly Profile[]): boolean {
  return !flags.isDisabled && profiles.includes(flags.profile)
}

/** Raw environment values the end-of-turn modules read (context, quota, delivery, notification). */
export type TurnEnv = Env & {
  contextMonitor?: string
  contextLimit?: string
  contextWarn?: string
  contextSoft?: string
  quotaAlert?: string
  quotaWarn?: string
  deliveryCheck?: string
  notify?: string
  notifyAfter?: string
}

export type TurnFlags = Flags & {
  isContextMonitorOff: boolean
  /** CC_CONTEXT_LIMIT, or 0 to use the window the API reports. */
  contextLimit: number
  warnAt: number
  soft: number
  isQuotaOff: boolean
  quotaWarn: string | undefined
  isDeliveryOff: boolean
  isNotifyOff: boolean
  notifyAfter: string | undefined
}

const isOff = (raw: string | undefined): boolean => String(raw ?? '').trim().toLowerCase() === 'off'

export function toTurnFlags(env: TurnEnv): TurnFlags {
  const limit = Number(env.contextLimit)
  return {
    ...toFlags(env),
    // ccx compares to 'off' exactly here, unlike its other switches.
    isContextMonitorOff: env.contextMonitor === 'off',
    contextLimit: limit > 0 ? limit : 0,
    warnAt: Number(env.contextWarn) || 0.7,
    soft: Number(env.contextSoft) || 150000,
    isQuotaOff: isOff(env.quotaAlert),
    quotaWarn: env.quotaWarn,
    isDeliveryOff: isOff(env.deliveryCheck),
    isNotifyOff: isOff(env.notify),
    notifyAfter: env.notifyAfter,
  }
}

/** Never leak an absolute home path into a message shown to the model. */
export function tilde(path: string, home: string): string {
  if (!path) return ''
  return home && path.startsWith(home) ? '~' + path.slice(home.length) : path
}
