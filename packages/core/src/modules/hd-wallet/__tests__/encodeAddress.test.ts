import { BIP32DerivationType } from 'hmd2v-xhd-wallet-api'
import { HDWalletService, encodeAddress } from '../hdWalletUtils'

describe('Blockchain address encoding', () => {
  it('Algorand: produces the expected address for a known BIP32 path and public key', async () => {
    // This test corresponds to what's in xHD-Wallet-API tests
    const mnemonic =
      'salon zoo engage submit smile frost later decide wing sight chaos renew lizard rely canal coral scene hobby scare step bus leaf tobacco slice'
    const wallet = await HDWalletService.fromMnemonic(mnemonic)

    // BIP32 path: m/44'/283'/0'/0/0 (Algorand standard)
    const account = 0
    const keyIndex = 0

    // Derive public key
    const pk = await wallet.generateAlgorandAddressKey(account, keyIndex, BIP32DerivationType.Khovratovich)

    // Encode address
    const address = encodeAddress(pk)

    // Assert address matches expected
    expect(address).toBe('ML7IGK322ECUJPUDG6THAQ26KBSK4STG4555PCIJOZNUNNLWU3Z3ZFXITA')
  })
})
