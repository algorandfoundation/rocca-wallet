import { toBase64URL, fromBase64Url } from '@algorandfoundation/liquid-client/lib/encoding'
import { sha256 } from '@noble/hashes/sha2'
import { buildAuthenticatorData, buildAttestationObject, getAttestedCredentialData } from './cbor'
import { captureConnectSid, syncConnectSidFromCookies } from './sessionCookie'

export type AttestationRequestOptions = {
  username: string
  displayName: string
  authenticatorSelection: { userVerification: 'required' | 'preferred' | 'discouraged' }
  extensions?: { [k: string]: any }
}

export async function requestAttestationOptions(
  baseUrl: string,
  userAgent: string,
  requestOptions: AttestationRequestOptions
): Promise<any> {
  const res = await fetch(`${baseUrl}/attestation/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify(requestOptions),
  })
  // Capture session cookie if present so we can share it with SignalClient
  try {
    const setCookie = res.headers.get('set-cookie')
    console.log('[LiquidAuth][DEBUG] Attestation request Set-Cookie header:', setCookie)
    captureConnectSid(setCookie)
  } catch {
    // ignore
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`requestAttestationOptions failed: HTTP ${res.status} ${text}`)
  }
  return res.json()
}

export type BuildCredentialParams = {
  encodedOptions: any
  originHost: string
  dp256PublicKey: Uint8Array
  algorandAddress: string
  algorandPublicKeyBytes: Uint8Array
  requestId: string
  signatureBytes: Uint8Array
}

export function buildRegistrationCredential(params: BuildCredentialParams): {
  credential: any
  rpId: string
  clientDataJSON: Uint8Array
  attestationObject: Uint8Array
} {
  const {
    encodedOptions,
    originHost,
    dp256PublicKey,
    algorandAddress,
    algorandPublicKeyBytes,
    requestId,
    signatureBytes,
  } = params

  const options: any = { ...encodedOptions }
  options.user = options.user || {}
  options.user.id = algorandPublicKeyBytes
  options.user.name = algorandAddress
  options.user.displayName = 'Rocca Mobile Wallet'
  options.challenge = fromBase64Url(options.challenge)
  if (options.excludeCredentials) {
    for (const cred of options.excludeCredentials) {
      cred.id = fromBase64Url(cred.id)
    }
  }

  const challenge: Uint8Array = options.challenge
  const rawIdBytes = sha256(dp256PublicKey)
  const rpId = options?.rp?.id ?? originHost

  const clientData = {
    type: 'webauthn.create',
    challenge: toBase64URL(challenge),
    origin: `https://${rpId}`,
  }
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData))

  const attestedCredData = getAttestedCredentialData('0c2f9507-9527-423e-bd51-15cae37ab8f0', rawIdBytes, dp256PublicKey)
  const authData = buildAuthenticatorData(rpId, attestedCredData, {
    userPresent: true,
    userVerified: true,
    backupEligible: true,
    backupState: true,
    signCount: 0,
    hasExtensions: false,
  })
  const attestationObject = buildAttestationObject(authData)

  const credential: any = {
    id: toBase64URL(rawIdBytes),
    rawId: toBase64URL(rawIdBytes),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64URL(clientDataJSON),
      attestationObject: toBase64URL(attestationObject),
    },
    clientExtensionResults: {
      liquid: {
        type: 'algorand',
        requestId,
        address: algorandAddress,
        signature: toBase64URL(signatureBytes),
        device: 'iPhone',
      },
    },
  }
  return { credential, rpId, clientDataJSON, attestationObject }
}

export async function submitAttestationResponse(
  baseUrl: string,
  userAgent: string,
  credential: any
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${baseUrl}/attestation/response`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify(credential),
  })
  // Capture session cookie if present on response
  try {
    const setCookie = res.headers.get('set-cookie')
    console.log('[LiquidAuth][DEBUG] Attestation response Set-Cookie header:', setCookie)
    captureConnectSid(setCookie)
  } catch {
    // ignore
  }
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}

// High-level flow to build and submit an attestation response.
// This encapsulates: request options -> sign liquid challenge -> build credential -> submit.
export async function runAttestationFlow(params: {
  baseUrl: string
  userAgent: string
  originHost: string
  dp256PublicKey: Uint8Array
  algorandAddress: string
  algorandPublicKeyBytes: Uint8Array
  requestId: string
  device?: string
  requestOptions: AttestationRequestOptions
  signAlgorandChallenge: (challenge: Uint8Array) => Promise<Uint8Array>
}): Promise<{ ok: boolean; status: number; body: string; credential: any; encodedOptions: any }> {
  const {
    baseUrl,
    userAgent,
    originHost,
    dp256PublicKey,
    algorandAddress,
    algorandPublicKeyBytes,
    requestId,
    device = 'iPhone',
    requestOptions,
    signAlgorandChallenge,
  } = params

  const encodedOptions = await requestAttestationOptions(baseUrl, userAgent, requestOptions)

  const challenge: Uint8Array = typeof encodedOptions.challenge === 'string'
    ? fromBase64Url(encodedOptions.challenge)
    : encodedOptions.challenge

  const signatureBytes = await signAlgorandChallenge(challenge)

  const { credential } = buildRegistrationCredential({
    encodedOptions,
    originHost,
    dp256PublicKey,
    algorandAddress,
    algorandPublicKeyBytes,
    requestId,
    signatureBytes,
  })

  // Attach the client extension here for convenience when using this flow directly
  credential.clientExtensionResults = {
    liquid: {
      type: 'algorand',
      requestId,
      address: algorandAddress,
      signature: toBase64URL(signatureBytes),
      device,
    },
  }

  const { ok, status, body } = await submitAttestationResponse(baseUrl, userAgent, credential)

  // In React Native, Set-Cookie is not exposed to JS, but the
  // native networking stack will have stored connect.sid for
  // this baseUrl. Sync it into our in-memory store so that
  // SignalClient can forward it on the Socket.IO handshake.
  try {
    await syncConnectSidFromCookies(baseUrl)
  } catch {
    // ignore; cookie sync is best-effort
  }

  return { ok, status, body, credential, encodedOptions }
}
