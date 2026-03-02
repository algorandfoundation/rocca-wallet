import React, { useReducer, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Alert, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Logo from '../components/Logo';
import SeedPhrase from '../components/SeedPhrase';

import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as bip39 from '@scure/bip39';
import { useProvider } from '@/hooks/useProvider'
import { mnemonicToSeed } from '@scure/bip39'


// Extract provider configuration from expo-constants
const config = Constants.expoConfig?.extra?.provider || {
  name: 'Rocca',
  primaryColor: '#3B82F6',
  secondaryColor: '#E1EFFF',
};

type OnboardingStep = 'welcome' | 'generate' | 'backup' | 'verify' | 'complete';

interface State {
  step: OnboardingStep;
  recoveryPhrase: string[] | null;
  testInput: { [key: number]: string };
}

type Action =
  | { type: 'SET_PHRASE'; phrase: string[] }
  | { type: 'SHOW_PHRASE' }
  | { type: 'VERIFY_START'; indices: number[] }
  | { type: 'VERIFY'; input: { [key: number]: string } }
  | { type: 'VERIFY_SUCCESS' }
  | { type: 'RESET' };

const initialState: State = {
  step: 'welcome',
  recoveryPhrase: null,
  testInput: {},
};

function onboardingReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_PHRASE':
      return { ...state, recoveryPhrase: action.phrase, step: 'generate' };
    case 'SHOW_PHRASE':
      return { ...state, step: 'backup' };
    case 'VERIFY_START':
      return {
        ...state,
        step: 'verify',
        testInput: Object.fromEntries(action.indices.map(idx => [idx, ''])),
      };
    case 'VERIFY':
      return { ...state, testInput: action.input };
    case 'VERIFY_SUCCESS':
      return {
        ...state,
        step: 'complete',
      };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

function getIndicatorStep (step: OnboardingStep) {
  if (step === 'welcome') return 1
  if (step === 'generate') return 2
  if (step === 'backup') return 2
  if (step === 'verify') return 3
  if (step === 'complete') return 3
  return 0
}

 function getSecurityMessage(step: OnboardingStep) {
   switch (step) {
     case 'generate':
     case 'backup':
       return 'Write down these 24 words in order and store them in a safe offline place. Do not take a screenshot.'
     case 'verify':
       return 'Enter the requested words from your phrase to confirm you have a correct backup.'
     default:
       return 'Your recovery phrase is the only way to recover your wallet. Keep it secret and never share it.'
   }
 }
export default function OnboardingScreen() {
  // UI Elements
  const { primaryColor, secondaryColor, name } = config
  const scrollViewRef = useRef<ScrollView>(null)

  // Expo Router for Navigation
  const router = useRouter()
  // Provider Context, used to hold global states and interfaces
  const { keys, key } = useProvider()
  // State reducer
  const [{ step, recoveryPhrase, testInput }, dispatch] =
    useReducer(onboardingReducer, initialState)

  // Helpers for state
  const currentIndicatorStep = getIndicatorStep(step)
  const securityMessage = getSecurityMessage(step)
  const isBackupVerified = step === 'complete'
  const isPhraseVisible = step === 'backup'
  const showTest = step === 'verify'

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerIndicator}>
        {/* Step Indicator */}
        {currentIndicatorStep > 0 && (
          <View style={styles.stepIndicator}>
            {[1, 2, 3].map((s) => (
              <View
                key={s}
                style={[
                  styles.stepDot,
                  currentIndicatorStep === s && [styles.stepDotActive, { backgroundColor: primaryColor }],
                  currentIndicatorStep > s && [styles.stepDotCompleted, { backgroundColor: secondaryColor }],
                ]}
              />
            ))}
            <Text style={styles.stepText}>Step {currentIndicatorStep} of 3</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        {step === 'welcome' ? (
          /* Step 1: Welcome */
          <View style={styles.welcomeContainer}>
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.welcomeHeader}>
                <Logo style={styles.logoContainer} size={80} />
                <Text style={styles.title}>Welcome to {name}</Text>
                <Text style={styles.subtitle}>
                  Your secure, decentralized identity for accessing rewards and managing digital assets.
                </Text>
              </View>

              <View style={styles.illustrationContainer}>
                <Image
                  source={require('../assets/images/onboarding.png')}
                  style={styles.onboardingGraphic}
                  resizeMode="contain"
                />
              </View>
            </ScrollView>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: primaryColor }]}
                onPress={() => {
                  if (keys.length > 0) {
                    router.replace('/landing')
                    return
                  }

                  // Update onboarding to include the text, this is used to validate the list
                  const phrase = bip39.generateMnemonic(wordlist, 256).split(' ')
                  dispatch({ type: 'SET_PHRASE', phrase })

                  // Scroll to the button once generation is complete
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true })
                  }, 100)
                }}
              >
                <Text style={styles.primaryButtonText}>Create Wallet</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryButton}>
                <Text style={[styles.secondaryButtonText, { color: primaryColor }]}>Import Existing Wallet</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Step 2: Secure Your Identity (Generating, Backup, Verify) */
          <View style={styles.onboardingContainer}>
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.header}>
                <Text style={styles.title}>Secure Your Identity.</Text>
              </View>

              <View style={styles.illustrationContainer}>
                <Logo size={100} />
              </View>

              <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>
                  {isBackupVerified
                      ? 'Identity Secured!'
                      : 'Secure Your Recovery Phrase'}
                </Text>

                {isBackupVerified ? (
                  <Animated.View entering={FadeIn.duration(400)} style={styles.successAnimation}>
                    <View style={[styles.successCircle, { backgroundColor: primaryColor }]}>
                      <MaterialIcons name="check" size={60} color="#FFFFFF" />
                    </View>
                  </Animated.View>
                ) : (
                  <Animated.View
                    key={step}
                    entering={FadeIn.duration(400)}
                    exiting={FadeOut.duration(400)}
                    style={styles.securityWarning}
                  >
                    <MaterialIcons name="security" size={20} color={primaryColor} />
                    <Text style={styles.securityWarningText}>{securityMessage}</Text>
                  </Animated.View>
                )}
              </View>

              {!isBackupVerified && (
                <>
                  <SeedPhrase
                    recoveryPhrase={recoveryPhrase || []}
                    showSeed={isPhraseVisible}
                    validateWords={showTest ? testInput : null}
                    onInputChange={(index, text) =>
                      dispatch({ type: 'VERIFY', input: { ...testInput, [index]: text } })
                    }
                    primaryColor={primaryColor}
                  />
                </>
              )}
            </ScrollView>

            {!isBackupVerified && (
              <View style={styles.buttonContainer}>
                {(() => {
                  switch (step) {
                    case 'generate':
                      return (
                        <TouchableOpacity
                          style={[styles.primaryButton, { backgroundColor: primaryColor }]}
                          onPress={() => dispatch({ type: 'SHOW_PHRASE' })}
                        >
                          <Text style={styles.primaryButtonText}>View Secret</Text>
                        </TouchableOpacity>
                      );
                    case 'backup':
                      return (
                        <TouchableOpacity
                          style={[styles.primaryButton, { backgroundColor: primaryColor }]}
                          onPress={() => {
                            const indices = [3, 7, 15, 21];
                            dispatch({ type: 'VERIFY_START', indices });
                          }}
                        >
                          <Text style={styles.primaryButtonText}>Verify Recovery Phrase</Text>
                        </TouchableOpacity>
                      );
                    case 'verify':
                      return (
                        <>
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={() => dispatch({ type: 'RESET' })}
                          >
                            <Text style={[styles.secondaryButtonText, { color: primaryColor }]}>Reset Onboarding</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
                            onPress={async () => {
                              const isCorrect = Object.entries(testInput).every(
                                ([index, value]) => value.toLowerCase().trim() === recoveryPhrase?.[Number(index)]
                              );
                              if (isCorrect) {
                                dispatch({ type: 'VERIFY_SUCCESS' });
                                if (recoveryPhrase === null) {
                                  throw new Error('Recovery phrase is null');
                                }

                                // Import to the keystore
                                await key.store.import(
                                  {
                                    type: 'hd-seed',
                                    algorithm: 'raw',
                                    extractable: true,
                                    keyUsages: ['deriveKey', 'deriveBits'],
                                    privateKey: await mnemonicToSeed(recoveryPhrase.join(' ')),
                                  },
                                  'bytes'
                                );

                                router.replace('/landing');

                              } else {
                                Alert.alert(
                                  'Verification Failed',
                                  "The words you entered don't match your recovery phrase. Would you like to try again or start over?",
                                  [
                                    { text: 'Try Again', style: 'cancel' },
                                    { text: 'Start Over', onPress: () => dispatch({ type: 'RESET' }), style: 'destructive' },
                                  ]
                                );
                              }
                            }}
                          >
                            <Text style={styles.primaryButtonText}>Check Words</Text>
                          </TouchableOpacity>
                        </>
                      );
                    default:
                      return (
                        <TouchableOpacity
                          style={[styles.primaryButton, { backgroundColor: primaryColor }]}
                          onPress={() => router.replace('/landing')}
                        >
                          <Text style={styles.primaryButtonText}>Complete onboarding</Text>
                        </TouchableOpacity>
                      );
                  }
                })()}
              </View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F7FF',
  },
  scrollContent: {
    flexGrow: 1,
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  headerIndicator: {
    paddingTop: 10,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CBD5E1',
  },
  stepDotActive: {
    width: 24,
  },
  stepDotCompleted: {
    backgroundColor: '#93C5FD',
  },
  stepText: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    flex: 1,
  },
  welcomeContainer: {
    flex: 1,
  },
  welcomeHeader: {
    alignItems: 'center',
    marginTop: 20,
  },
  logoContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 10,
    marginBottom: 20,
  },
  onboardingContainer: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    minHeight: 150,
  },
  onboardingGraphic: {
    width: '100%',
    height: 250,
  },
  infoSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 12,
  },
  successAnimation: {
    marginVertical: 20,
    alignItems: 'center',
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  securityWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FEF3C7',
    marginTop: 5,
    gap: 10,
  },
  securityWarningText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  buttonContainer: {
    gap: 12,
    marginTop: 20,
    paddingBottom: 10,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
