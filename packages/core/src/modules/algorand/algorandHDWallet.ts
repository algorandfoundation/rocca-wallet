import { getHDWalletRootKey, hasHDWalletKey } from '../../services/hdWalletKeychain'
import { encodeAddress, HDWalletService } from '../hd-wallet/hdWalletUtils'
import { loadMnemonic } from '../../services/keychain'

/**
 * Algorand HD Wallet Module
 * Low-level module for Algorand address and key generation using stored HD wallet keys
 */

export const createAlgorandHDWalletService = async (
  title?: string,
  description?: string
): Promise<HDWalletService | null> => {
  try {
    const rootKey = await getHDWalletRootKey(title, description)

    if (rootKey) {
      return new HDWalletService(rootKey)
    }

    const mnemonic = await loadMnemonic(title, description)

    if (mnemonic) {
      return await HDWalletService.fromMnemonic(mnemonic)
    }

    return null
  } catch (error) {
    return null
  }
}

export const generateAlgorandAddress = async (
  account: number = 0,
  addressIndex: number = 0,
  title?: string,
  description?: string
): Promise<string | null> => {
  try {
    const hdWallet = await createAlgorandHDWalletService(title, description)

    if (!hdWallet) {
      return null
    }

    const address = await hdWallet.generateAlgorandAddressKey(account, addressIndex)
    return encodeAddress(address)
  } catch (error) {
    return null
  }
}

export const generateAlgorandAddresses = async (
  account: number = 0,
  count: number = 10,
  startIndex: number = 0,
  title?: string,
  description?: string
): Promise<string[]> => {
  try {
    const hdWallet = await createAlgorandHDWalletService(title, description)

    if (!hdWallet) {
      return []
    }

    const addresses: string[] = []

    for (let i = 0; i < count; i++) {
      const addressIndex = startIndex + i
      const address = await hdWallet.generateAlgorandAddressKey(account, addressIndex)
      addresses.push(encodeAddress(address))
    }

    return addresses
  } catch (error) {
    return []
  }
}

export const isAlgorandHDWalletAvailable = async (): Promise<boolean> => {
  try {
    const hasHDKey = await hasHDWalletKey()

    if (hasHDKey) {
      return true
    }

    const mnemonic = await loadMnemonic()
    return mnemonic !== undefined
  } catch (error) {
    return false
  }
}

export const getAlgorandWalletInfo = async (
  title?: string,
  description?: string
): Promise<{
  hasHDKey: boolean
  hasMnemonic: boolean
  derivationTimestamp?: number
} | null> => {
  try {
    const hasHDKey = await hasHDWalletKey()

    let derivationTimestamp: number | undefined
    if (hasHDKey) {
      derivationTimestamp = Date.now()
    }

    const mnemonic = await loadMnemonic(title, description)
    const hasMnemonic = mnemonic !== undefined

    return {
      hasHDKey,
      hasMnemonic,
      derivationTimestamp,
    }
  } catch (error) {
    return null
  }
}
