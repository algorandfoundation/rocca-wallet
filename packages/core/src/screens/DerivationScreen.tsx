import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { StackScreenProps } from '@react-navigation/stack'
import { useTranslation } from 'react-i18next'

import { OnboardingStackParams } from '../types/navigators'
import { loadMnemonic } from '../services/keychain'
import { storeDp256MainKey } from '../services/hdWalletKeychain'
import { DeterministicP256 } from '@algorandfoundation/dp256'
import { useStore } from '../contexts/store'
import { DispatchAction } from '../contexts/reducers/store'

type Props = StackScreenProps<OnboardingStackParams, any>

const DerivationScreen: React.FC<Props> = ({ route }) => {
  const { t } = useTranslation()
  const [store, dispatch] = useStore()
  const [isWorking, setIsWorking] = useState(false)

  // Move the heavy derivation logic inside useEffect so the linter
  // does not require `startDerivation` as a dependency.

  useEffect(() => {
    const startDerivation = async () => {
      setIsWorking(true)

      // Allow spinner to render before starting CPU-bound work
      await new Promise((res) => requestAnimationFrame(() => res(null)))
      await new Promise((res) => setTimeout(res, 0))

      // Determine mnemonic: prefer route param, fallback to secure storage
      const mnemonicFromRoute = (route && route.params && (route.params as any).mnemonic) as string | undefined
      let mnemonic = mnemonicFromRoute
      if (!mnemonic) {
        try {
          mnemonic = await loadMnemonic()
        } catch (e) {
          mnemonic = undefined
        }
      }

      if (!mnemonic) {
        setIsWorking(false)
        Alert.alert(String(t('Global.Error') ?? 'Error'), 'Mnemonic not available for derivation')
        return
      }

      try {
        const dp = new DeterministicP256()
        const derivedMainKey: Uint8Array = await dp.genDerivedMainKeyWithBIP39(
          mnemonic,
          new TextEncoder().encode('liquid'),
          10,
          512
        )

        const useBiometry = store.preferences.useBiometry
        const storeResult = await storeDp256MainKey(derivedMainKey, useBiometry)

        if (!storeResult) {
          throw new Error('Failed to store dp256 main key')
        }

        dispatch({ type: DispatchAction.DID_COMPLETE_DERIVATION })
      } catch (err: any) {
        Alert.alert(String(t('Global.Error') ?? 'Error'), err?.message || String(err), [
          {
            text: 'Retry',
            onPress: () => startDerivation(),
          },
          { text: 'Skip', style: 'cancel', onPress: () => dispatch({ type: DispatchAction.DID_COMPLETE_DERIVATION }) },
        ])
      } finally {
        setIsWorking(false)
      }
    }

    startDerivation()
    return () => {
      // cleanup if unmounted while working
    }
    // We only want to run this on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // We navigated here from `MnemonicSet` after the user confirmed. No extra
  // confirmation needed — show generating UI immediately.

  return (
    <View style={styles.container}>
      {isWorking ? (
        <>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.text}>Generating cryptographic material</Text>
        </>
      ) : (
        <Text style={styles.text}>Generating cryptographic material</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { marginTop: 12, textAlign: 'center', color: '#333' },
  textBold: { fontWeight: '700', fontSize: 18, color: '#333' },
})

export default DerivationScreen
