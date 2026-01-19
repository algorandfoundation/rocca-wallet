import { Platform } from 'react-native'

/**
 * Build a compact user-agent string compatible with ua-parser-js.
 * Format: `<appPrefix> (<deviceModel>; <OSName> <OSVersion>)`
 * Example: `liquid-auth/1.0 (iPhone; iOS 18.5)`
 *
 * The function prefers `react-native-device-info` when available
 * (keeps user agent more specific); otherwise falls back to
 * `Platform` values. This is synchronous and safe to call during
 * startup.
 */
export function getUserAgent(appPrefix = 'liquid-auth/1.0'): string {
  let deviceModel: string | undefined
  let osName: string | undefined
  let osVersion: string | undefined

  // Prefer react-native-device-info if it's installed (optional)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DeviceInfo = require('react-native-device-info')
    if (DeviceInfo) {
      if (typeof DeviceInfo.getModel === 'function') deviceModel = DeviceInfo.getModel()
      if (typeof DeviceInfo.getSystemName === 'function') osName = DeviceInfo.getSystemName()
      if (typeof DeviceInfo.getSystemVersion === 'function') osVersion = DeviceInfo.getSystemVersion()
    }
  } catch {
    // ignore — device-info not installed
  }

  // Fallbacks using React Native Platform
  const platform = Platform.OS || 'unknown'
  if (!osName) osName = platform === 'ios' ? 'ios' : platform === 'android' ? 'android' : platform.toLowerCase()

  if (!osVersion) {
    const v = Platform.Version
    // Platform.Version can be number or string
    osVersion = typeof v === 'number' ? String(v) : (v as string | undefined)
  }

  if (!deviceModel) {
    // Use short lowercase fallbacks so ua-parser-js will parse consistently
    deviceModel = platform === 'ios' ? 'iphone' : platform === 'android' ? 'android' : platform.toLowerCase()
  }

  // sanitize fields (remove parentheses/semicolons which may confuse parsers)
  const sanitize = (s?: string) => (s ? s.replace(/[();]/g, ' ').trim().toLowerCase() : '')

  const model = sanitize(deviceModel)
  const name = sanitize(osName)
  const ver = sanitize(osVersion)

  return `${appPrefix} (${model}; ${name}${ver ? ' ' + ver : ''})`
}

function uncap(s: string) {
  if (!s) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export default getUserAgent
