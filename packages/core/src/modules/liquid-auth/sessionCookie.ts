import Cookies from '@react-native-cookies/cookies'
import { bifoldLoggerInstance as logger } from '../../services/bifoldLogger'

let connectSid: string | null = null

// Capture connect.sid from a Set-Cookie header string
export function captureConnectSid(setCookieHeader: string | null) {
  if (!setCookieHeader) return

  // There may be multiple cookies in the header; look specifically for connect.sid
  const match = setCookieHeader.match(/connect\.sid=([^;]+)/)
  if (!match) return

  try {
    // Store the raw value; encoding will be handled when sending
    connectSid = decodeURIComponent(match[1])
  } catch (e) {
    connectSid = match[1]
  }
}

// Build a Cookie header value for use in Socket.IO extraHeaders
export function getConnectSidCookieHeader(): string | undefined {
  if (!connectSid) {
    return undefined
  }
  // Minimal cookie header with just connect.sid
  const encoded = encodeURIComponent(connectSid)
  return `connect.sid=${encoded}`
}

// For React Native: pull connect.sid out of the native cookie jar
// for the given base URL (e.g. https://beetle-never.ngrok-free.app).
// This is necessary because React Native fetch does not expose the
// Set-Cookie header to JavaScript.
export async function syncConnectSidFromCookies(baseUrl: string): Promise<void> {
  try {
    const cookies = await Cookies.get(baseUrl)
    const sid = (cookies as any)['connect.sid']

    if (sid && typeof sid.value === 'string' && sid.value.length > 0) {
      connectSid = decodeURIComponent(sid.value)
    } else {
      logger.debug('[LiquidAuth][DEBUG] syncConnectSidFromCookies: no connect.sid found in native cookie jar', {
        baseUrl,
      })
    }
  } catch (e) {
    logger.debug('[LiquidAuth][DEBUG] syncConnectSidFromCookies: error reading native cookies', {
      baseUrl,
      error: e,
    })
  }
}
