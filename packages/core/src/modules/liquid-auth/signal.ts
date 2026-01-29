import { SignalClient } from '@algorandfoundation/liquid-client'
export type { SignalClient } from '@algorandfoundation/liquid-client'
import { getConnectSidCookieHeader } from './sessionCookie'
import { bifoldLoggerInstance as logger } from '../../services/bifoldLogger'

export type SignalHandlers = {
  onLink?: () => void
  onMessage?: (message: string) => void
  onError?: (error: string) => void
  onConnected?: () => void
  onStatus?: (status: string) => void
}

export function createSignalClient(baseUrl: string, handlers?: SignalHandlers): SignalClient {
  const cookieHeader = getConnectSidCookieHeader()
  const options: any = { autoConnect: true }

  // For React Native / non-browser clients, we must manually forward the
  // HTTP session cookie so that the signaling server can associate this
  // socket with the same session/wallet used during attestation/assertion.
  if (cookieHeader) {
    options.extraHeaders = {
      Cookie: cookieHeader,
    }
  } else {
    logger.debug('[LiquidAuth][DEBUG] createSignalClient: no Cookie header available for socket.io handshake', {
      baseUrl,
    })
  }

  const client = new SignalClient(baseUrl, options)
  if (handlers?.onLink) {
    client.on('link', handlers.onLink as any)
  }
  return client
}

export async function preLink(client: SignalClient, requestId: string): Promise<void> {
  // Create a promise that resolves when the 'link' event fires
  const linkPromise = new Promise<void>((resolve) => {
    const handler = () => {
      resolve()
    }
    client.once('link', handler as any)
  })

  // Call link (this may or may not return a resolving promise)
  client.link(requestId).catch((e) => {
    logger.debug('[LiquidAuth][DEBUG] preLink: client.link promise rejected', { error: e })
  })

  // Wait for either the link event OR a timeout (silent on timeout)
  await Promise.race([linkPromise, sleep(3000)])
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error('ICE timeout')), ms)))
  try {
    const result = await Promise.race([p, timeout])
    clearTimeout(t)
    return result as T
  } catch (e) {
    clearTimeout(t)
    throw e
  }
}

export async function startPeer(
  client: SignalClient,
  reqId: string,
  handlers?: SignalHandlers,
  attempts: number = 3,
  backoffMs: number = 600,
  timeoutMs: number = 8000
): Promise<void> {
  logger.debug('[LiquidAuth][DEBUG] startPeer called', { reqId, socketId: (client as any).socket?.id })

  // liquid-client's SignalClient requires an authenticated flag before it will
  // process SDP descriptions via signal(type). In the browser module flow this
  // flag is set by calling client.link(requestId) (preLink), but in our Rocca
  // flows we perform WebAuthn ourselves and do not call SignalClient.attestation
  // or link(). Since we have already established the HTTP session/cookies via
  // WebAuthn, we can safely mark the client as authenticated here so that
  // signal(type) will attach listeners for answer-description/offer-description
  // and drive setRemoteDescription/addIceCandidate.
  if (!(client as any).authenticated) {
    logger.debug('[LiquidAuth][DEBUG] Forcing SignalClient authenticated=true before peer')
    ;(client as any).authenticated = true
  }

  // Add socket event listener for debugging
  try {
    const socket = (client as any).socket
    if (socket) {
      // attach minimal diagnostics only in case of errors
      const originalEmit = socket.emit.bind(socket)
      socket.emit = function (...args: any[]) {
        return originalEmit(...args)
      }
    }
  } catch (e) {
    logger.debug('[LiquidAuth][DEBUG] Could not attach socket listener', { error: e })
  }

  try {
    const iceServers = [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun3.l.google.com:19302',
          'stun:stun4.l.google.com:19302',
        ],
      },
      {
        urls: [
          'turn:global.turn.nodely.network:80?transport=tcp',
          'turns:global.turn.nodely.network:443?transport=tcp',
          'turn:eu.turn.nodely.io:80?transport=tcp',
          'turns:eu.turn.nodely.io:443?transport=tcp',
          'turn:us.turn.nodely.io:80?transport=tcp',
          'turns:us.turn.nodely.io:443?transport=tcp',
        ],
        username: 'liquid-auth',
        credential: 'sqmcP4MiTKMT4TGEDSk9jgHY',
      },
    ]

    handlers?.onStatus?.('Starting peer')

    const dataChannel = await withTimeout(
      client.peer(reqId, 'answer', {
        iceServers,
        iceCandidatePoolSize: 20,
      }),
      timeoutMs
    )

    // WebRTC debug: data channel lifecycle and peer connection state
    try {
      const dc: any = dataChannel as any
      if (dc) {
        logger.debug('[LiquidAuth][DEBUG] DataChannel created', { label: dc.label })
        const originalOnError = dc.onerror
        dc.onerror = (event: any) => {
          logger.error('[LiquidAuth][DEBUG] DataChannel onerror', { label: dc.label, error: event })
          originalOnError?.(event)
        }

        // Try to introspect underlying RTCPeerConnection for state changes
        const pc: any =
          dc._peerConnection || dc.peerConnection || (client as any)._peerConnection || (client as any).peerConnection

        if (pc) {
          // keep RTCPeerConnection introspection minimal
          logger.debug('[LiquidAuth][DEBUG] RTCPeerConnection present')
        }
      }
    } catch (pcErr) {
      logger.debug('[LiquidAuth][DEBUG] Error attaching WebRTC debug handlers', { error: pcErr })
    }

    handlers?.onConnected?.()
    ;(dataChannel as any).onmessage = (event: MessageEvent) => {
      try {
        const msg = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
        handlers?.onMessage?.(msg)
      } catch {
        handlers?.onMessage?.('[unreadable message]')
      }
    }
    // Expose the data channel and a safe send helper on the client so
    // callers (e.g. LiquidAuthScan) can send ARC27 responses back to the
    // browser over the established data channel.
    try {
      ;(client as any)._dataChannel = dataChannel
      ;(client as any).sendData = (payload: string) => {
        try {
          ;(client as any)._dataChannel?.send(payload)
        } catch (e) {
          logger.debug('[LiquidAuth][DEBUG] sendData failed', { error: e })
        }
      }
    } catch (e) {
      logger.debug('[LiquidAuth][DEBUG] could not attach dataChannel to client', { error: e })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Gracefully retry when server says a request is already in process
    if (attempts > 1 && /request in process/i.test(message)) {
      await sleep(backoffMs)
      handlers?.onStatus?.('Retry: request in process')
      logger.debug('[LiquidAuth][DEBUG] startPeer retry: request in process', { reqId })
      return startPeer(client, reqId, handlers, attempts - 1, Math.min(backoffMs * 2, 2500), timeoutMs)
    }
    // If connectivity fails, retry
    if (attempts > 1 && /(ice|stun|candidate|network|timeout)/i.test(message)) {
      await sleep(backoffMs)
      handlers?.onStatus?.('Retry: connection error')
      logger.debug('[LiquidAuth][DEBUG] startPeer retry: connectivity error', { reqId, message })
      return startPeer(client, reqId, handlers, attempts - 1, Math.min(backoffMs * 2, 2500), timeoutMs)
    }
    logger.error('[LiquidAuth][ERROR] startPeer failed', { reqId, message })
    handlers?.onError?.(message)
    throw e
  }
}
