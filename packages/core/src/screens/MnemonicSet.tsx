import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useState } from 'react'
import { View, Text, StyleSheet, Alert } from 'react-native'
import { useTranslation } from 'react-i18next'

import MnemonicDisplay from '../components/misc/MnemonicDisplay'
import KeyboardView from '../components/views/KeyboardView'
import { useStore } from '../contexts/store'
import { DispatchAction } from '../contexts/reducers/store'
import { useTheme } from '../contexts/theme'
import { OnboardingStackParams, Screens } from '../types/navigators'
import { generateMnemonic } from '../modules/hd-wallet/bip39Utils'
import { storeMnemonic } from '../services/keychain'
import { generateAndStoreHDWalletKey } from '../services/hdWalletKeychain'

const MnemonicSet: React.FC = () => {
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const [store, dispatch] = useStore()
  const navigation = useNavigation<StackNavigationProp<OnboardingStackParams>>()

  const [isLoading, setIsLoading] = useState(false)

  // Generate a new 24-word mnemonic on component load
  const [generatedMnemonic] = useState(() => generateMnemonic())
  const mnemonicWords = generatedMnemonic.split(' ')

  // Heavy work performed after user confirms backup
  const performContinue = async (mnemonic: string) => {
    console.debug('[MnemonicSet] performContinue: start')
    setIsLoading(true)
    try {
      // Yield to the UI so the loading indicator can render before expensive work
      // Use requestAnimationFrame then a macrotask to force a paint on React Native
      await new Promise((res) => requestAnimationFrame(() => res(null)))
      await new Promise((res) => setTimeout(res, 0))
      const useBiometry = store.preferences.useBiometry
      console.debug('[MnemonicSet] storing mnemonic in keychain')
      const success = await storeMnemonic(mnemonic, useBiometry)
      console.debug('[MnemonicSet] storeMnemonic result=', success)

      if (!success) {
        throw new Error('Keychain storage returned false')
      }

      // Generate and store HD wallet root key from the mnemonic
      console.debug('[MnemonicSet] generating HD wallet root key')
      const hdKeySuccess = await generateAndStoreHDWalletKey(mnemonic, '', useBiometry)
      // Derivation moved to a separate screen to avoid blocking the UI thread.
      // We'll navigate to the `Derivation` screen which shows a generating message.
      // The heavy dp256 derivation and storage has been commented out here and
      // will be performed (or mocked) from the `Derivation` screen when ready.
      console.debug('[MnemonicSet] marking onboarding DID_SET_MNEMONIC')
      dispatch({ type: DispatchAction.DID_SET_MNEMONIC })
      console.debug('[MnemonicSet] navigating to Derivation screen')
      navigation.navigate(Screens.Derivation, { mnemonic })

    }
    catch (err) {
      console.error('[MnemonicSet] performContinue error', err)
      Alert.alert(t('Global.Error') || 'Error', (err as Error)?.message || String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: ColorPalette.grayscale.white,
      padding: 16,
    },
    header: {
      fontSize: 20,
      fontWeight: '600',
      color: ColorPalette.grayscale.darkGrey,
      marginTop: 12,
      marginBottom: 8,
    },
  })

  return (
    <KeyboardView keyboardAvoiding={false}>
      <View style={styles.container}>

        <MnemonicDisplay
          mnemonicWords={mnemonicWords}
          generatedMnemonic={generatedMnemonic}
          isLoading={isLoading}
          onContinue={performContinue}
        />
      </View>
    </KeyboardView>
  )
}

export default MnemonicSet