import { SignalClient } from '@algorandfoundation/liquid-client/lib/signal'
export type { SignalClient } from '@algorandfoundation/liquid-client/lib/signal'
import { getConnectSidCookieHeader } from './sessionCookie'

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
    console.log('[LiquidAuth][DEBUG] createSignalClient: attaching Cookie header to socket.io handshake', {
      baseUrl,
      cookieHeader,
    })
    options.extraHeaders = {
      Cookie: cookieHeader,
    }
  } else {
    console.log('[LiquidAuth][DEBUG] createSignalClient: no Cookie header available for socket.io handshake', {
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
  console.log('[LiquidAuth][DEBUG] preLink starting', { requestId })

  // Create a promise that resolves when the 'link' event fires
  const linkPromise = new Promise<void>((resolve) => {
    const handler = () => {
      console.log('[LiquidAuth][DEBUG] preLink: link event received')
      resolve()
    }
    client.once('link', handler as any)
  })

  // Call link (this may or may not return a resolving promise)
  client.link(requestId).catch((e) => {
    console.log('[LiquidAuth][DEBUG] preLink: client.link promise rejected', e)
  })

  // Wait for either the link event OR a timeout
  await Promise.race([
    linkPromise,
    sleep(3000).then(() => {
      console.log('[LiquidAuth][DEBUG] preLink: timeout, proceeding anyway')
    })
  ])

  console.log('[LiquidAuth][DEBUG] preLink done', { requestId })
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
  timeoutMs: number = 8000,
): Promise<void> {
  console.log('[LiquidAuth][DEBUG] startPeer called', { reqId, socketId: (client as any).socket?.id })

  // liquid-client's SignalClient requires an authenticated flag before it will
  // process SDP descriptions via signal(type). In the browser module flow this
  // flag is set by calling client.link(requestId) (preLink), but in our Rocca
  // flows we perform WebAuthn ourselves and do not call SignalClient.attestation
  // or link(). Since we have already established the HTTP session/cookies via
  // WebAuthn, we can safely mark the client as authenticated here so that
  // signal(type) will attach listeners for answer-description/offer-description
  // and drive setRemoteDescription/addIceCandidate.
  if (!(client as any).authenticated) {
    console.log('[LiquidAuth][DEBUG] Forcing SignalClient authenticated=true before peer')
      ; (client as any).authenticated = true
  }

  // Add socket event listener for debugging
  try {
    const socket = (client as any).socket
    if (socket) {
      console.log('[LiquidAuth][DEBUG] Attaching socket listeners')

      // Log all outgoing events
      const originalEmit = socket.emit.bind(socket)
      socket.emit = function (...args: any[]) {
        console.log('[LiquidAuth][DEBUG] Socket EMIT:', args[0], JSON.stringify(args.slice(1)).slice(0, 200))
        return originalEmit(...args)
      }

      // Log all incoming events
      socket.onAny?.((eventName: string, ...args: any[]) => {
        console.log('[LiquidAuth][DEBUG] Socket RECEIVE:', eventName, JSON.stringify(args).slice(0, 200))
      })
    } else {
      console.log('[LiquidAuth][DEBUG] No socket found on client')
    }
  } catch (e) {
    console.log('[LiquidAuth][DEBUG] Could not attach socket listener', e)
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
      timeoutMs,
    )

    // WebRTC debug: data channel lifecycle and peer connection state
    try {
      const dc: any = dataChannel as any
      if (dc) {
        console.log('[LiquidAuth][DEBUG] DataChannel created', {
          label: dc.label,
          readyState: dc.readyState,
        })

        const originalOnOpen = dc.onopen
        const originalOnClose = dc.onclose
        const originalOnError = dc.onerror

        dc.onopen = (event: any) => {
          console.log('[LiquidAuth][DEBUG] DataChannel onopen', {
            label: dc.label,
            readyState: dc.readyState,
          })
          originalOnOpen?.(event)
        }

        dc.onclose = (event: any) => {
          console.log('[LiquidAuth][DEBUG] DataChannel onclose', {
            label: dc.label,
            readyState: dc.readyState,
          })
          originalOnClose?.(event)
        }

        dc.onerror = (event: any) => {
          console.log('[LiquidAuth][DEBUG] DataChannel onerror', {
            label: dc.label,
            readyState: dc.readyState,
            error: event,
          })
          originalOnError?.(event)
        }

        // Try to introspect underlying RTCPeerConnection for state changes
        const pc: any =
          dc._peerConnection ||
          dc.peerConnection ||
          (client as any)._peerConnection ||
          (client as any).peerConnection

        if (pc) {
          console.log('[LiquidAuth][DEBUG] RTCPeerConnection initial state', {
            iceConnectionState: pc.iceConnectionState,
            connectionState: pc.connectionState,
          })

          const originalIceHandler = pc.oniceconnectionstatechange
          pc.oniceconnectionstatechange = (event: any) => {
            console.log('[LiquidAuth][DEBUG] RTCPeerConnection iceConnectionState change', {
              iceConnectionState: pc.iceConnectionState,
            })
            originalIceHandler?.(event)
          }

          const originalConnHandler = pc.onconnectionstatechange
          pc.onconnectionstatechange = (event: any) => {
            console.log('[LiquidAuth][DEBUG] RTCPeerConnection connectionState change', {
              connectionState: pc.connectionState,
            })
            originalConnHandler?.(event)
          }
        } else {
          console.log('[LiquidAuth][DEBUG] RTCPeerConnection not found on dataChannel/SignalClient')
        }
      }
    } catch (pcErr) {
      console.log('[LiquidAuth][DEBUG] Error attaching WebRTC debug handlers', pcErr)
    }

    handlers?.onConnected?.()

      ; (dataChannel as any).onmessage = (event: MessageEvent) => {
        try {
          const msg = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
          handlers?.onMessage?.(msg)
        } catch {
          handlers?.onMessage?.('[unreadable message]')
        }
      }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Gracefully retry when server says a request is already in process
    if (attempts > 1 && /request in process/i.test(message)) {
      await sleep(backoffMs)
      handlers?.onStatus?.('Retry: request in process')
      return startPeer(client, reqId, handlers, attempts - 1, Math.min(backoffMs * 2, 2500), timeoutMs)
    }
    // If connectivity fails, retry
    if (attempts > 1 && /(ice|stun|candidate|network|timeout)/i.test(message)) {
      await sleep(backoffMs)
      handlers?.onStatus?.('Retry: connection error')
      return startPeer(
        client,
        reqId,
        handlers,
        attempts - 1,
        Math.min(backoffMs * 2, 2500),
        timeoutMs,
      )
    }
    handlers?.onError?.(message)
    throw e
  }
}
