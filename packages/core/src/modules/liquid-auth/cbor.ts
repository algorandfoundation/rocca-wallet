import { sha256 } from '@noble/hashes/sha2'
import { fromBase64Url, toBase64URL } from '@algorandfoundation/liquid-client'
import { decode as cborDecode } from 'cbor-x'

// TODO: explore what can be replaced with cbor-x functions

// Convert dp256 64-byte public key (x||y) to uncompressed 65-byte form (0x04||x||y)
function toUncompressed(pubKey: Uint8Array): Uint8Array {
  if (pubKey.length === 65 && pubKey[0] === 0x04) return pubKey
  if (pubKey.length !== 64) throw new Error('Invalid dp256 public key length')
  const out = new Uint8Array(65)
  out[0] = 0x04
  out.set(pubKey, 1)
  return out
}

// Build COSE EC2 key for P-256 using manual CBOR encoding so server decodes to Map with .get()
function buildCoseEc2Key(uncompressedPub: Uint8Array): Uint8Array {
  const x = uncompressedPub.slice(1, 33)
  const y = uncompressedPub.slice(33, 65)

  const encodeUIntSmall = (n: number): Uint8Array => {
    if (n < 0 || n >= 24) throw new Error('encodeUIntSmall expects 0<=n<24')
    return Uint8Array.from([n])
  }
  const encodeNIntSmall = (n: number): Uint8Array => {
    // n is negative, small magnitude, e.g., -1 -> 0x20, -2 -> 0x21, -3 -> 0x22, -7 -> 0x26
    const m = -1 - n
    if (m < 0 || m >= 24) throw new Error('encodeNIntSmall expects small negative')
    return Uint8Array.from([0x20 + m])
  }
  const encodeBytes = (b: Uint8Array): Uint8Array => {
    const len = b.length
    if (len < 24) {
      return Uint8Array.from([0x40 + len, ...b])
    } else if (len < 256) {
      return Uint8Array.from([0x58, len, ...b])
    } else if (len < 65536) {
      return Uint8Array.from([0x59, (len >>> 8) & 0xff, len & 0xff, ...b])
    } else {
      throw new Error('Byte string too long')
    }
  }

  // COSE key map with 5 pairs
  const header = Uint8Array.from([0xa5]) // map(5)

  // 1: 2 (kty: EC2)
  const k1 = encodeUIntSmall(1)
  const v1 = encodeUIntSmall(2)
  // 3: -7 (alg: ES256)
  const k2 = encodeUIntSmall(3)
  const v2 = encodeNIntSmall(-7)
  // -1: 1 (crv: P-256)
  const k3 = encodeNIntSmall(-1)
  const v3 = encodeUIntSmall(1)
  // -2: x (32 bytes)
  const k4 = encodeNIntSmall(-2)
  const v4 = encodeBytes(x)
  // -3: y (32 bytes)
  const k5 = encodeNIntSmall(-3)
  const v5 = encodeBytes(y)

  const out = new Uint8Array(
    header.length +
      k1.length +
      v1.length +
      k2.length +
      v2.length +
      k3.length +
      v3.length +
      k4.length +
      v4.length +
      k5.length +
      v5.length
  )
  let o = 0
  out.set(header, o)
  o += header.length
  out.set(k1, o)
  o += k1.length
  out.set(v1, o)
  o += v1.length
  out.set(k2, o)
  o += k2.length
  out.set(v2, o)
  o += v2.length
  out.set(k3, o)
  o += k3.length
  out.set(v3, o)
  o += v3.length
  out.set(k4, o)
  o += k4.length
  out.set(v4, o)
  o += v4.length
  out.set(k5, o)
  o += k5.length
  out.set(v5, o)
  o += v5.length
  return out
}

// Attested Credential Data = aaguid || L (2 bytes BE) || credentialId || CBOR(COSEKey)
function buildAttestedCredentialData(
  aaguid: Uint8Array,
  credentialId: Uint8Array,
  cborCoseKey: Uint8Array
): Uint8Array {
  const len = credentialId.length
  const L = Uint8Array.from([(len >> 8) & 0xff, len & 0xff])
  const out = new Uint8Array(aaguid.length + 2 + len + cborCoseKey.length)
  out.set(aaguid, 0)
  out.set(L, aaguid.length)
  out.set(credentialId, aaguid.length + 2)
  out.set(cborCoseKey, aaguid.length + 2 + len)
  return out
}

// Get complete Attested Credential Data structure
export function getAttestedCredentialData(
  aaguid: string,
  credentialId: Uint8Array,
  publicKey: Uint8Array // 64-byte (x||y) or 65-byte (0x04||x||y)
): Uint8Array {
  const aaguidBytes = aaguidFromString(aaguid)
  const uncompressed = toUncompressed(publicKey)
  const coseKey = buildCoseEc2Key(uncompressed)
  return buildAttestedCredentialData(aaguidBytes, credentialId, coseKey)
}

// Parse UUID string (e.g., "1F59713A-C021-4E63-9158-2CC5FDC14E52") into 16-byte AAGUID
function aaguidFromString(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '').toLowerCase()
  if (hex.length !== 32) throw new Error('Invalid UUID string')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

// Authenticator Data = rpIdHash || flags || signCount || attestedCredData
// Flags per WebAuthn spec
const UP = 1 << 0
const UV = 1 << 2
const BE = 1 << 3
const BS = 1 << 4
const AT = 1 << 6
const ED = 1 << 7

export function buildAuthenticatorData(
  rpId: string,
  attestedCredData?: Uint8Array,
  opts?: {
    userPresent?: boolean
    userVerified?: boolean
    backupEligible?: boolean
    backupState?: boolean
    signCount?: number
    hasExtensions?: boolean
  }
): Uint8Array {
  const rpIdHash = sha256(new TextEncoder().encode(rpId))
  const {
    userPresent = true,
    userVerified = true,
    backupEligible = true,
    backupState = true,
    signCount = 0,
    hasExtensions = false,
  } = opts || {}

  let flagsByte = 0
  if (userPresent) flagsByte |= UP
  if (userVerified) flagsByte |= UV
  if (backupEligible) flagsByte |= BE
  if (backupState) flagsByte |= BS
  if (attestedCredData && attestedCredData.length > 0) flagsByte |= AT
  if (hasExtensions) flagsByte |= ED

  const flags = Uint8Array.from([flagsByte])
  const signCountBytes = Uint8Array.from([
    (signCount >>> 24) & 0xff,
    (signCount >>> 16) & 0xff,
    (signCount >>> 8) & 0xff,
    signCount & 0xff,
  ])

  const attestedLen = attestedCredData ? attestedCredData.length : 0
  const out = new Uint8Array(rpIdHash.length + flags.length + signCountBytes.length + attestedLen)
  out.set(rpIdHash, 0)
  out.set(flags, rpIdHash.length)
  out.set(signCountBytes, rpIdHash.length + flags.length)
  if (attestedCredData && attestedLen > 0) {
    out.set(attestedCredData, rpIdHash.length + flags.length + signCountBytes.length)
  }
  return out
}

// Attestation Object map: { fmt: 'none', attStmt: {}, authData }
// Encode attestation object using canonical CBOR so server tiny-cbor decoder returns a Map with .get()
export function buildAttestationObject(authData: Uint8Array): Uint8Array {
  // Helper encoders
  const encodeText = (s: string): Uint8Array => {
    const bytes = new TextEncoder().encode(s)
    const len = bytes.length
    if (len < 24) {
      return Uint8Array.from([0x60 + len, ...bytes])
    } else if (len < 256) {
      return Uint8Array.from([0x78, len, ...bytes])
    } else {
      // Not expected for our keys/values
      throw new Error('Text too long')
    }
  }
  const encodeEmptyMap = (): Uint8Array => Uint8Array.from([0xa0])
  const encodeBytes = (b: Uint8Array): Uint8Array => {
    const len = b.length
    if (len < 24) {
      const header = 0x40 + len
      return Uint8Array.from([header, ...b])
    } else if (len < 256) {
      return Uint8Array.from([0x58, len, ...b])
    } else if (len < 65536) {
      return Uint8Array.from([0x59, (len >>> 8) & 0xff, len & 0xff, ...b])
    } else {
      throw new Error('Byte string too long')
    }
  }

  // Map with 3 pairs: attStmt(empty map), authData(bytes), fmt('none')
  const mapHeader = Uint8Array.from([0xa3]) // map(3)
  const k1 = encodeText('attStmt')
  const v1 = encodeEmptyMap()
  const k2 = encodeText('authData')
  const v2 = encodeBytes(authData)
  const k3 = encodeText('fmt')
  const v3 = encodeText('none')

  const out = new Uint8Array(mapHeader.length + k1.length + v1.length + k2.length + v2.length + k3.length + v3.length)
  let offset = 0
  out.set(mapHeader, offset)
  offset += mapHeader.length
  out.set(k1, offset)
  offset += k1.length
  out.set(v1, offset)
  offset += v1.length
  out.set(k2, offset)
  offset += k2.length
  out.set(v2, offset)
  offset += v2.length
  out.set(k3, offset)
  offset += k3.length
  out.set(v3, offset)
  offset += v3.length
  return out
}

// ---- Base64URL helpers ----
export function base64UrlEncode(bytes: Uint8Array): string {
  // Use shared helper to ensure consistent URL-safe Base64 across platforms
  return toBase64URL(bytes)
}

export function decodeBase64Url(input: string): Uint8Array | null {
  try {
    return fromBase64Url(input)
  } catch {
    return null
  }
}

export function decodeBase64UrlToJSON(input: string): string | null {
  const bytes = decodeBase64Url(input)
  if (!bytes) return null
  const dict: Record<string, number> = {}
  for (let i = 0; i < bytes.length; i++) dict[String(i)] = bytes[i]
  try {
    return JSON.stringify(dict, null, 2)
  } catch {
    return null
  }
}

export function decodeBase64UrlCBORIfPossible(input: string): string | null {
  const bytes = decodeBase64Url(input)
  if (!bytes) return null
  try {
    const decoded = cborDecode(bytes)
    // Convert Map to a plain object for logging if necessary
    let obj: any = decoded
    if (decoded instanceof Map) {
      obj = Object.fromEntries(decoded as Map<any, any>)
    }
    return JSON.stringify(obj, (_k, v) => (v === null ? undefined : v), 2)
  } catch {
    return null
  }
}
