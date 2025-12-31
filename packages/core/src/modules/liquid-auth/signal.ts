import { SignalClient } from '@algorandfoundation/liquid-client/lib/signal'
export type { SignalClient } from '@algorandfoundation/liquid-client/lib/signal'

export type SignalHandlers = {
  onLink?: () => void
  onMessage?: (message: string) => void
  onError?: (error: string) => void
  onConnected?: () => void
  onStatus?: (status: string) => void
}

export type IceMode = 'default' | 'turn-only'

export function createSignalClient(baseUrl: string, handlers?: SignalHandlers): SignalClient {
  const client = new SignalClient(baseUrl, { autoConnect: true })
  if (handlers?.onLink) {
    client.on('link', handlers.onLink as any)
  }
  return client
}

export async function preLink(client: SignalClient, requestId: string): Promise<void> {
  await client.link(requestId)
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
  iceMode: IceMode = 'default',
  timeoutMs: number = 8000,
): Promise<void> {
  try {
    const defaultIce = [
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
    const turnOnlyIce = [
      {
        urls: [
          'turns:global.turn.nodely.network:443?transport=tcp',
          'turns:eu.turn.nodely.io:443?transport=tcp',
          'turns:us.turn.nodely.io:443?transport=tcp',
        ],
        username: 'liquid-auth',
        credential: 'sqmcP4MiTKMT4TGEDSk9jgHY',
      },
    ]
    // Use default STUN+TURN unless explicitly running in TURN-only mode
    const iceServers = iceMode === 'turn-only' ? turnOnlyIce : defaultIce

    handlers?.onStatus?.(`Starting peer (mode: ${iceMode})`)
    const dataChannel = await withTimeout(
      client.peer(reqId, 'answer', {
        iceServers,
        iceCandidatePoolSize: 10,
        // Prefer relay-only routing in TURN-only mode when supported
        ...(iceMode === 'turn-only' ? { iceTransportPolicy: 'relay' as any } : {}),
      }),
      timeoutMs,
    )

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
      return startPeer(client, reqId, handlers, attempts - 1, Math.min(backoffMs * 2, 2500), iceMode, timeoutMs)
    }
    // If connectivity fails, retry with the same ICE mode (no automatic TURN-only fallback)
    if (attempts > 1 && /(ice|stun|candidate|network|timeout)/i.test(message)) {
      await sleep(backoffMs)
      handlers?.onStatus?.('Retry: connection error; default ICE only')
      return startPeer(
        client,
        reqId,
        handlers,
        attempts - 1,
        Math.min(backoffMs * 2, 2500),
        iceMode,
        timeoutMs,
      )
    }
    handlers?.onError?.(message)
    throw e
  }
}
