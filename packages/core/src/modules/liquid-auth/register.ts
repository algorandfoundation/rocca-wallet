import { toBase64URL, fromBase64Url } from '@algorandfoundation/liquid-client/lib/encoding'
import { sha256 } from '@noble/hashes/sha2'
import { buildAuthenticatorData, buildAttestationObject, getAttestedCredentialData } from './cbor'

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
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}
