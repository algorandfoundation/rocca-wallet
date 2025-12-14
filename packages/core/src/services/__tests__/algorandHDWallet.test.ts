import { createAlgorandHDWalletService, generateAlgorandAddress } from '../algorandHDWallet'
import { base32 } from '@scure/base'
import { sha512_256 } from '@noble/hashes/sha2.js'

// Known mnemonic used in existing encodeAddress test
const mnemonic =
  'salon zoo engage submit smile frost later decide wing sight chaos renew lizard rely canal coral scene hobby scare step bus leaf tobacco slice'

jest.mock('../hdWalletKeychain', () => ({
  getHDWalletRootKey: jest.fn().mockResolvedValue(null),
  hasHDWalletKey: jest.fn().mockResolvedValue(false),
}))

jest.mock('../keychain', () => ({
  loadMnemonic: jest.fn().mockResolvedValue(mnemonic),
}))

describe('Algorand HD Wallet Service (end-to-end)', () => {
  it('creates service from mnemonic and generates a valid Algorand address', async () => {
    const svc = await createAlgorandHDWalletService()
    expect(svc).not.toBeNull()

    const addr = await generateAlgorandAddress(0, 0)
    expect(addr).not.toBeNull()
    if (!addr) return

    // Address formatting: 58 chars, uppercase, Base32 alphabet
    expect(addr).toMatch(/^[A-Z2-7]{58}$/)

    // Decode and validate checksum: last 4 bytes equals SHA-512/256(publicKey) last 4 bytes
    const padLen = (8 - (addr.length % 8)) % 8
    const padded = addr + '='.repeat(padLen)
    const decoded = base32.decode(padded)
    expect(decoded).toHaveLength(36)
    const pubkey = decoded.slice(0, 32)
    const checksum = decoded.slice(32)
    const hash = sha512_256(pubkey)
    const expectedChecksum = hash.slice(-4)
    expect(Buffer.from(checksum)).toEqual(Buffer.from(expectedChecksum))
  })
})
