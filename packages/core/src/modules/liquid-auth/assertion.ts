import { toBase64URL, fromBase64Url } from '@algorandfoundation/liquid-client/lib/encoding'
import { sha256 } from '@noble/hashes/sha2'
import { buildAuthenticatorData } from './cbor'
import { captureConnectSid, syncConnectSidFromCookies } from './sessionCookie'

export async function requestAssertionOptions(baseUrl: string, userAgent: string, credId: string): Promise<any> {
  const res = await fetch(`${baseUrl}/assertion/request/${credId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    // iOS passes { extensions: true } in the request body
    body: JSON.stringify({ extensions: true }),
  })
  // Capture session cookie if present so we can share it with SignalClient
  try {
    const setCookie = res.headers.get('set-cookie')
    console.log('[LiquidAuth][DEBUG] Assertion request Set-Cookie header:', setCookie)
    captureConnectSid(setCookie)
  } catch {
    // ignore
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`requestAssertionOptions failed: HTTP ${res.status} ${text}`)
  }
  return res.json()
}

export type BuildAssertionParams = {
  encodedOptions: any
  originHost: string
  dp256Sign: (payload: Uint8Array) => Uint8Array
  toDer: (rawSig: Uint8Array) => Uint8Array
  dp256PublicKey: Uint8Array
  algorandAddress: string
  requestId: string
  algorandSignatureBytes: Uint8Array
  userHandle?: string
}

// Use dp256.toDer provided by caller for DER formatting

export function buildAssertionCredential(params: BuildAssertionParams): {
  credential: any
  rpId: string
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
} {
  const { encodedOptions, originHost, dp256Sign, toDer, dp256PublicKey, userHandle } = params

  const options: any = { ...encodedOptions }
  const rpId = options?.rpId || options?.rp?.id || originHost
  const challenge: Uint8Array =
    typeof options.challenge === 'string' ? fromBase64Url(options.challenge) : options.challenge

  const clientData = {
    type: 'webauthn.get',
    challenge: toBase64URL(challenge),
    origin: `https://${rpId}`,
  }
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData))

  // For assertion, there is NO attested credential data.
  // Pass undefined to ensure the AT flag (bit 6) is not set
  // and no attested bytes are appended, matching iOS behavior.
  const authenticatorData = buildAuthenticatorData(rpId, undefined, {
    userPresent: true,
    userVerified: true,
    backupEligible: true,
    backupState: true,
    signCount: 0,
    hasExtensions: false,
  })

  const clientHash = sha256(clientDataJSON)

  const toBeSignedRaw = new Uint8Array(authenticatorData.length + clientHash.length)
  toBeSignedRaw.set(authenticatorData, 0)
  toBeSignedRaw.set(clientHash, authenticatorData.length)
  const toBeSigned = sha256(toBeSignedRaw)

  const signatureRaw = dp256Sign(toBeSigned)
  const signatureDer = toDer(signatureRaw)

  const rawIdBytes = sha256(dp256PublicKey)
  const credId = toBase64URL(rawIdBytes)

  const credential: any = {
    id: credId,
    type: 'public-key',
    userHandle: userHandle ?? 'tester',
    rawId: credId,
    response: {
      clientDataJSON: toBase64URL(clientDataJSON),
      authenticatorData: toBase64URL(authenticatorData),
      signature: toBase64URL(signatureDer),
    },
  }

  return { credential, rpId, clientDataJSON, authenticatorData }
}

export async function submitAssertionResponse(
  baseUrl: string,
  userAgent: string,
  credential: any,
  liquidExt: { type: string; requestId: string; address: string; signature: string; device: string }
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${baseUrl}/assertion/response`
  const payload: any = {
    ...credential,
    clientExtensionResults: {
      liquid: liquidExt,
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify(payload),
  })
  // Capture session cookie if present on response
  try {
    const setCookie = res.headers.get('set-cookie')
    console.log('[LiquidAuth][DEBUG] Assertion response Set-Cookie header:', setCookie)
    captureConnectSid(setCookie)
  } catch {
    // ignore
  }
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}

// High-level flow to build and submit an assertion response.
// This encapsulates: request options -> sign liquid challenge -> build credential -> submit.
export async function runAssertionFlow(params: {
  baseUrl: string
  userAgent: string
  originHost: string
  dp256PublicKey: Uint8Array
  dp256Sign: (payload: Uint8Array) => Uint8Array
  toDer: (rawSig: Uint8Array) => Uint8Array
  address: string
  requestId: string
  device?: string
  signAlgorandChallenge: (challenge: Uint8Array) => Promise<Uint8Array>
}): Promise<{ ok: boolean; status: number; body: string; credential: any }> {
  const {
    baseUrl,
    userAgent,
    originHost,
    dp256PublicKey,
    dp256Sign,
    toDer,
    address,
    requestId,
    device = 'iPhone',
    signAlgorandChallenge,
  } = params

  // Compute credentialId from dp256 public key
  const credId = toBase64URL(sha256(dp256PublicKey))

  // Request assertion options
  const encodedOptions = await requestAssertionOptions(baseUrl, userAgent, credId)

  // Prepare Algorand signature over challenge for liquid extension
  const challengeBytes: Uint8Array =
    typeof encodedOptions.challenge === 'string' ? fromBase64Url(encodedOptions.challenge) : encodedOptions.challenge
  const algSigBytes = await signAlgorandChallenge(challengeBytes)

  // Build assertion credential (DER signature)
  const { credential } = buildAssertionCredential({
    encodedOptions,
    originHost,
    dp256Sign,
    toDer,
    dp256PublicKey,
    algorandAddress: address,
    requestId,
    algorandSignatureBytes: algSigBytes,
    userHandle: address,
  })

  const liquidExt = {
    type: 'algorand',
    requestId,
    address,
    signature: toBase64URL(algSigBytes),
    device,
  }

  const { ok, status, body } = await submitAssertionResponse(baseUrl, userAgent, credential, liquidExt)

  // Same as attestation: after assertion completes, the native
  // cookie jar should contain connect.sid for this baseUrl.
  // Sync it into memory so SignalClient can reuse it.
  try {
    await syncConnectSidFromCookies(baseUrl)
  } catch {
    // ignore; cookie sync is best-effort
  }

  return { ok, status, body, credential }
}
