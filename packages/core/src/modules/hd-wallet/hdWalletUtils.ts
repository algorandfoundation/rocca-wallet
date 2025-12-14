import * as bip39 from '@scure/bip39'
import { sha512_256 } from '@noble/hashes/sha2.js'
import { base32 } from '@scure/base'
import { fromSeed, XHDWalletAPI, KeyContext, BIP32DerivationType, SignMetadata, Encoding } from 'hmd2v-xhd-wallet-api'
import { validateMnemonic } from './bip39Utils'
import authScema from './auth.request.json'

/**
 * HD Wallet utilities for Algorand key derivation using xHD-Wallet-API
 */

/**
 * Async version: Creates a root key from a BIP39 mnemonic phrase
 * @param mnemonic BIP39 mnemonic phrase
 * @param passphrase Optional passphrase (empty string by default)
 * @returns Promise<Uint8Array> (96 bytes)
 */
export const createRootKeyFromMnemonicAsync = async (
  mnemonic: string,
  passphrase: string = ''
): Promise<Uint8Array> => {
  const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase)
  return fromSeed(Buffer.from(seed))
}

/**
 * HD Wallet service for key generation and derivation
 */
export class HDWalletService {
  private cryptoService: XHDWalletAPI
  private rootKey: Uint8Array

  constructor(rootKey: Uint8Array) {
    this.cryptoService = new XHDWalletAPI()
    this.rootKey = rootKey
  }

  static async fromMnemonic(mnemonic: string, passphrase: string = ''): Promise<HDWalletService> {
    const rootKey = await createRootKeyFromMnemonicAsync(mnemonic, passphrase)
    return new HDWalletService(rootKey)
  }

  static fromRootKey(precomputedRootKey: Uint8Array): HDWalletService {
    return new HDWalletService(precomputedRootKey)
  }

  async generateAlgorandAddressKey(
    account: number,
    addressIndex: number,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert
  ): Promise<Uint8Array> {
    return await this.cryptoService.keyGen(this.rootKey, KeyContext.Address, account, addressIndex, derivationType)
  }

  async generateIdentityKey(
    account: number,
    addressIndex: number,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert
  ): Promise<Uint8Array> {
    return await this.cryptoService.keyGen(this.rootKey, KeyContext.Identity, account, addressIndex, derivationType)
  }

  getRootKey(): Uint8Array {
    return this.rootKey
  }

  getCryptoService(): XHDWalletAPI {
    return this.cryptoService
  }

  async signAlgorandTransaction(
    account: number,
    addressIndex: number,
    prefixEncodedTx: Uint8Array,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert
  ): Promise<Uint8Array> {
    return await this.cryptoService.signAlgoTransaction(
      this.rootKey,
      KeyContext.Address,
      account,
      addressIndex,
      prefixEncodedTx,
      derivationType
    )
  }

  async performECDH(
    keyContext: KeyContext,
    account: number,
    addressIndex: number,
    otherPartyPublicKey: Uint8Array,
    isClient: boolean
  ): Promise<Uint8Array> {
    return await this.cryptoService.ECDH(this.rootKey, keyContext, account, addressIndex, otherPartyPublicKey, isClient)
  }

  /**
   * Signs arbitrary data bytes using the Address key context, validated by a JSON schema ID.
   * This is suitable for challenge/response style authentication payloads.
   */
  async signChallengeBytes(
    account: number,
    addressIndex: number,
    data: Uint8Array,
    encoding: Encoding = Encoding.NONE,
    derivationType: BIP32DerivationType = BIP32DerivationType.Peikert
  ): Promise<Uint8Array> {
    // Delegates to underlying API's signData with schema validation
    // API expects: (rootKey, keyContext, account, index, data, schemaId, derivationType)

    const metadata: SignMetadata = { encoding: encoding, schema: authScema }

    return await this.cryptoService.signData(
      this.rootKey,
      KeyContext.Address,
      account,
      addressIndex,
      data,
      metadata,
      derivationType
    )
  }
}

/**
 * Async creates an HD wallet service instance from a mnemonic
 * @param mnemonic BIP39 mnemonic phrase
 * @param passphrase Optional passphrase
 * @returns Promise<HDWalletService>
 */
export const createHDWalletAsync = async (mnemonic: string, passphrase?: string): Promise<HDWalletService> => {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid BIP39 mnemonic phrase')
  }
  return await HDWalletService.fromMnemonic(mnemonic, passphrase)
}

/**
 * Encodes a public key into a Base32 Algorand address, which includes a checksum at the end
 * @param publicKey Public key as Uint8Array (32 bytes)
 * @returns Algorand Address
 */
export function encodeAddress(publicKey: Uint8Array): string {
  const hash = sha512_256(publicKey) // 32 bytes
  const checksum = hash.slice(-4) // last 4 bytes
  const addressBytes = new Uint8Array([...publicKey, ...checksum])
  return base32.encode(addressBytes).replace(/=+$/, '').toUpperCase()
}
