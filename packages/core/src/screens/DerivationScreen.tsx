import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native'
import { StackScreenProps } from '@react-navigation/stack'
import { useTranslation } from 'react-i18next'

import { OnboardingStackParams, Screens } from '../types/navigators'
import { storeMnemonic, loadMnemonic } from '../services/keychain'
import { generateAndStoreHDWalletKey, storeDp256MainKey } from '../services/hdWalletKeychain'
import { DeterministicP256 } from '@algorandfoundation/dp256'
import { useStore } from '../contexts/store'
import { DispatchAction } from '../contexts/reducers/store'

type Props = StackScreenProps<OnboardingStackParams, any>

const DerivationScreen: React.FC<Props> = ({ route, navigation }) => {
  const { t } = useTranslation()
  const [store, dispatch] = useStore()
  const [isWorking, setIsWorking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const startDerivation = async () => {
    // NOTE: heavy derivation logic intentionally commented out for now.
    // This screen currently only shows a UI placeholder while the expensive
    // dp256 derivation implementation is deferred or mocked for debugging.
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
      Alert.alert(t('Global.Error') || 'Error', 'Mnemonic not available for derivation')
      return
    }

    try {
      console.debug('[DerivationScreen] starting dp256 derivation')

      // Construct DeterministicP256 and derive main key using BIP39
      // This operation is CPU-intensive and may block the JS thread.
      const dp = new DeterministicP256()
      const derivedMainKey: Uint8Array = await dp.genDerivedMainKeyWithBIP39(mnemonic)

      console.debug('[DerivationScreen] derived main key length=', derivedMainKey?.length)

      // Persist derived main key to secure storage (keychain)
      const useBiometry = store.preferences.useBiometry
      const storeResult = await storeDp256MainKey(derivedMainKey, useBiometry)

      if (!storeResult) {
        throw new Error('Failed to store dp256 main key')
      }

      // Mark derivation complete so onboarding advances
      dispatch({ type: DispatchAction.DID_COMPLETE_DERIVATION })
    } catch (err: any) {
      console.error('[DerivationScreen] derivation error', err)
      // If dp256 isn't available or derivation fails, fall back to a short simulated delay
      Alert.alert(t('Global.Error') || 'Error', err?.message || String(err), [
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

  useEffect(() => {
    startDerivation()
    return () => {
      // cleanup if unmounted while working
    }
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
