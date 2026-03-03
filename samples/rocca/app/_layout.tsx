import { Stack } from "expo-router";
import { install } from 'react-native-quick-crypto'
import { keyStore } from '@/stores/keystore'
import { keyStoreHooks } from '@/stores/before-after'
import { fetchSecret, getMasterKey, storage } from '@algorandfoundation/react-native-keystore'
import { initializeKeyStore, Key, KeyData, KeyStoreState, setStatus } from '@algorandfoundation/keystore'
import { Store } from '@tanstack/store'
import { accountsStore } from '@/stores/accounts'
import { ReactNativeProvider, WalletProvider } from '@/providers/ReactNativeProvider'

install()

async function bootstrap() {
  setStatus({ store: keyStore as unknown as Store<KeyStoreState>, status: 'loading' })
  const secrets = await Promise.all(
    storage.getAllKeys().map(async (keyId) => fetchSecret<KeyData>({ keyId, masterKey: await getMasterKey() }))
  )
  initializeKeyStore({
    store: keyStore as unknown as Store<KeyStoreState>,
    keys: secrets.filter((k) => k !== null).map(({ privateKey, ...rest }: KeyData) => rest) as Key[],
  })
}
bootstrap()
export default function RootLayout() {
  return (
    <WalletProvider
      provider={
        new ReactNativeProvider(
          {
            id: 'react-native-wallet',
            name: 'React Native Wallet',
          },
          {
            logs: true,
            accounts: {
              store: accountsStore,
              keystore: {
                autoPopulate: true,
              },
            },
            keystore: {
              store: keyStore,
              hooks: keyStoreHooks,
            },
          }
        )
      }
    >
      <Stack />
    </WalletProvider>
  )
}
