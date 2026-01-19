import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { StackScreenProps } from '@react-navigation/stack'

import { ThemedText } from '../components/texts/ThemedText'
import { useTheme } from '../contexts/theme'
import { Screens, SettingStackParams } from '../types/navigators'
import { isAlgorandHDWalletAvailable, createAlgorandHDWalletService } from '../services/algorandHDWallet'
import { hasHDWalletKey, generateAndStoreHDWalletKey } from '../services/hdWalletKeychain'
import { loadMnemonic } from '../services/keychain'
import { DeterministicP256 } from '@algorandfoundation/dp256'
import { loadDp256MainKey } from '../services/hdWalletKeychain'
import type { HDWalletService } from '../modules/hd-wallet/hdWalletUtils'
import * as signal from '../modules/liquid-auth/signal'
import { encodeAddress } from '../modules/hd-wallet/hdWalletUtils'
import { runAttestationFlow } from '../modules/liquid-auth/register'
import type { AttestationRequestOptions } from '../modules/liquid-auth/register'
import { runAssertionFlow } from '../modules/liquid-auth/assertion'
import { bifoldLoggerInstance as logger } from '../services/bifoldLogger'
import getUserAgent from '../modules/liquid-auth/userAgent'

type Props = StackScreenProps<SettingStackParams, Screens.LiquidAuthSettings>

const LiquidAuthSettings: React.FC<Props> = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()

  const [liquidAuthSignalingUrl, setliquidAuthSignalingUrl] = useState<string>('https://debug.liquidauth.com')
  const [pawnEndpoint, setPawnEndpoint] = useState<string>("https://worm-different.ngrok.dev")
  // Helper to fetch requestId from Pawn Endpoint
  const fetchRequestId = useCallback(async () => {
    if (!pawnEndpoint) throw new Error("Pawn Endpoint is required")
    const url = `${pawnEndpoint.replace(/\/$/, '')}/v1/liquid/start`
    console.log('[LiquidAuth][DEBUG] Fetching Pawn Endpoint:', url)
    const res = await fetch(url)
    console.log('[LiquidAuth][DEBUG] Pawn Endpoint response status:', res.status)
    if (!res.ok) throw new Error(`Failed to fetch from Pawn Endpoint: ${res.status}`)
    const data = await res.json()
    console.log('[LiquidAuth][DEBUG] Pawn Endpoint response JSON:', data)
    if (!data.requestId) throw new Error("No requestId in Pawn Endpoint response")
    console.log('[LiquidAuth][DEBUG] Received requestId:', data.requestId)
    return data.requestId
  }, [pawnEndpoint])
  const [loading, setLoading] = useState<'register' | 'authenticate' | null>(null)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [address, setAddress] = useState<string | undefined>()
  const [dp256PublicKey, setDp256PublicKey] = useState<Uint8Array | undefined>()
  const [dp256PrivateKey, setDp256PrivateKey] = useState<any | null>(null)
  const [origin, setOrigin] = useState<string | undefined>()
  const [signalClient, setSignalClient] = useState<signal.SignalClient | null>(null)
  const [hdWalletService, setHdWalletService] = useState<HDWalletService | null>(null)
  const [progress, setProgress] = useState<'idle' | 'linking' | 'registering' | 'authenticating' | 'starting-peer' | 'connected' | 'failed'>('idle')
  const [linkReady, setLinkReady] = useState<boolean>(false)
  const isStartingPeerRef = useRef(false)
  const [lastSignalMessage, setLastSignalMessage] = useState<string | undefined>()
  const [signalError, setSignalError] = useState<string | undefined>()


  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
      paddingHorizontal: 24,
      paddingTop: 24,
    },
    heading: {
      marginBottom: 8,
    },
    paragraph: {
      marginTop: 8,
    },
    input: {
      marginTop: 16,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      color: TextTheme.normal.color,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    actions: {
      marginTop: 16,
      gap: 12,
    },
    button: {
      backgroundColor: ColorPalette.brand.primary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonDisabled: {
      backgroundColor: ColorPalette.grayscale.mediumGrey,
    },
    resultBox: {
      marginTop: 16,
      padding: 12,
      borderRadius: 8,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
    },
  })

  // Initialize wallet and dp256. SignalClient will be created lazily after
  // attestation/assertion so that it can reuse the established HTTP session.
  useEffect(() => {
    let mounted = true
    const run = async () => {
      try {

        setError('')
        console.log('[LiquidAuth][DEBUG] useEffect: initializing wallet and keys')
        // Ensure mnemonic / HD wallet is available
        const available = await isAlgorandHDWalletAvailable()
        console.log('[LiquidAuth][DEBUG] Algorand HD Wallet available:', available)
        if (!available) {
          setError('Recovery phrase not set. Please set your recovery phrase first.')
          return
        }
        const hasKey = await hasHDWalletKey()
        console.log('[LiquidAuth][DEBUG] Has HD Wallet Key:', hasKey)
        if (!hasKey) {
          const mnemonic = await loadMnemonic()
          console.log('[LiquidAuth][DEBUG] Loaded mnemonic:', !!mnemonic)
          if (mnemonic) {
            try {
              await generateAndStoreHDWalletKey(mnemonic)
              console.log('[LiquidAuth][DEBUG] Generated and stored HD Wallet Key')
            } catch {
              // continue
            }
          }
        }
        const hd = await createAlgorandHDWalletService()
        if (mounted) setHdWalletService(hd)
        if (hd) {
          const publicKeyBytes = await hd.generateAlgorandAddressKey(0, 0)
          const addrStr = encodeAddress(publicKeyBytes)
          if (mounted) setAddress(addrStr)
          console.log('[LiquidAuth][DEBUG] Algorand address:', addrStr)
        }
        // dp256 derivation
        const mnemonic = await loadMnemonic()
        if (mnemonic) {
          const dp256 = new DeterministicP256()

          // REQUIRE: dp256 derived main key must be present (derived at onboarding)
          const derivedKey = await loadDp256MainKey()
          if (!derivedKey) {
            const msg = 'Missing dp256 derived main key. Complete onboarding or restore your recovery phrase.'
            console.error('[LiquidAuth][Settings] ', msg)
            if (mounted) {
              setError(msg)
              setProgress('failed')
            }
            return
          }
          // Parse origin host from liquidAuthSignalingUrl without relying on global URL constructor
          const originHost = (() => {
            try {
              const m = liquidAuthSignalingUrl.match(/^https?:\/\/([^/]+)/i)
              return m?.[1] ?? liquidAuthSignalingUrl
            } catch {
              return liquidAuthSignalingUrl
            }
          })()
          setOrigin(originHost)
          console.log('[LiquidAuth][DEBUG] Origin host:', originHost)
          const userHandle = address ?? 'anonymous@local'
          const privateKey = await dp256.genDomainSpecificKeyPair(derivedKey, originHost, userHandle)
          const publicKeyBytes = dp256.getPurePKBytes(privateKey)
          if (mounted) {
            setDp256PublicKey(publicKeyBytes)
            setDp256PrivateKey(privateKey)
            console.log('[LiquidAuth][DEBUG] dp256 public key:', publicKeyBytes)
          }
          // SignalClient is not created here; we delay it until after
          // attestation/assertion so that the HTTP session (connect.sid)
          // is established and can be forwarded to the signaling server.
        }
      } catch (e) {
        setError((e as Error).message)
        console.log('[LiquidAuth][DEBUG] useEffect error:', e)
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [liquidAuthSignalingUrl])

  const startSignalFlow = React.useCallback(async (client: signal.SignalClient, reqId: string) => {
    if (isStartingPeerRef.current) return
    isStartingPeerRef.current = true

    console.log('[LiquidAuth][DEBUG] startSignalFlow: Starting peer directly (no preLink)', { reqId })
    // Backend (Pawn) already linked when it created requestId with peer(..., 'offer')
    // Mobile just needs to call peer(..., 'answer') without additional link()

    setProgress('starting-peer')
    return signal
      .startPeer(client, reqId, {
        onConnected: () => {
          setProgress('connected')
        },
        onMessage: (m) => {
          setLastSignalMessage(m)
        },
        onError: (e) => {
          logger.error('[LiquidAuth][Settings] Signal error', { error: e as unknown as Record<string, unknown> })
          setSignalError(e)
          setProgress('failed')
        },
      })
      .finally(() => {
        isStartingPeerRef.current = false
      })
  }, [setProgress, setLastSignalMessage, setSignalError])

  const onRegister = useCallback(async () => {
    if (!origin || !hdWalletService || !dp256PublicKey) return
    try {
      setLoading('register')
      setResult('')
      setError('')
      setProgress('registering')
      console.log('[LiquidAuth][DEBUG] Register: Fetching requestId from Pawn Endpoint')
      const reqId = await fetchRequestId()
      console.log('[LiquidAuth][DEBUG] Register: Got requestId', reqId)
      // Add 2 second delay after fetching requestId
      await new Promise((r) => setTimeout(r, 2000))
      const baseUrl = liquidAuthSignalingUrl
      const publicKeyBytes: Uint8Array = await hdWalletService.generateAlgorandAddressKey(0, 0)
      const algorandAddress = encodeAddress(publicKeyBytes)
      console.log('[LiquidAuth][DEBUG] Register: Attestation start', { baseUrl, origin, requestId: reqId, algorandAddress, linkReady })
      const requestOptions: AttestationRequestOptions = {
        username: algorandAddress,
        displayName: 'Liquid Auth User',
        authenticatorSelection: { userVerification: 'required' },
        extensions: { liquid: true },
      }
      const userAgent = getUserAgent()
      const { ok, status } = await runAttestationFlow({
        baseUrl,
        userAgent,
        originHost: origin!,
        dp256PublicKey: dp256PublicKey!,
        algorandAddress,
        algorandPublicKeyBytes: publicKeyBytes,
        requestId: reqId,
        device: 'iPhone',
        requestOptions,
        signAlgorandChallenge: (bytes) => hdWalletService.signChallengeBytes(0, 0, bytes),
      })
      console.log('[LiquidAuth][DEBUG] Register: Attestation response', { ok, status })
      if (!ok) throw new Error(`Attestation failed: HTTP ${status}`)
      await new Promise((r) => setTimeout(r, 600))

      // Create SignalClient lazily after attestation so that it can
      // reuse the HTTP session (connect.sid) established above.
      console.log('[LiquidAuth][DEBUG] Register: Creating SignalClient post-attestation')
      const client = signal.createSignalClient(baseUrl, {
        onLink: () => {
          setLinkReady(true)
          if (progress === 'linking') setProgress('idle')
          console.log('[LiquidAuth][DEBUG] SignalClient linked (register)')
        },
      })
      setSignalClient(client)
      console.log('[LiquidAuth][DEBUG] Register: Starting peer post-attestation')
      await startSignalFlow(client, reqId)
    } catch (e) {
      logger.error('[LiquidAuth][Settings] Attestation error', { error: e as unknown as Record<string, unknown> })
      setError((e as Error).message)
      setProgress('failed')
      console.log('[LiquidAuth][DEBUG] Register: Error', e)
    } finally {
      setLoading(null)
    }
  }, [origin, hdWalletService, dp256PublicKey, liquidAuthSignalingUrl, linkReady, signalClient, fetchRequestId, startSignalFlow])

  const onAuthenticate = useCallback(async () => {
    if (!origin || !hdWalletService || !dp256PublicKey || !dp256PrivateKey || !address) return
    try {
      setLoading('authenticate')
      setError('')
      setResult('')
      setProgress('authenticating')
      console.log('[LiquidAuth][DEBUG] Authenticate: Fetching requestId from Pawn Endpoint')
      const reqId = await fetchRequestId()
      console.log('[LiquidAuth][DEBUG] Authenticate: Got requestId', reqId)
      // Add 2 second delay after fetching requestId
      await new Promise((r) => setTimeout(r, 2000))
      const baseUrl = liquidAuthSignalingUrl
      const userAgent = getUserAgent()
      console.log('[LiquidAuth][DEBUG] Authenticate: Assertion start', { baseUrl, origin, requestId: reqId, address, linkReady })
      const dp256 = new DeterministicP256()
      const { ok, status } = await runAssertionFlow({
        baseUrl,
        userAgent,
        originHost: origin!,
        dp256PublicKey: dp256PublicKey!,
        dp256Sign: (payload: Uint8Array) => dp256.signWithDomainSpecificKeyPair(dp256PrivateKey, payload),
        toDer: (raw: Uint8Array) => dp256.rawToDER(raw),
        address: address!,
        requestId: reqId,
        device: 'iPhone',
        signAlgorandChallenge: (bytes) => hdWalletService.signChallengeBytes(0, 0, bytes),
      })
      console.log('[LiquidAuth][DEBUG] Authenticate: Assertion response', { ok, status })
      if (!ok) throw new Error(`Assertion failed: HTTP ${status}`)
      await new Promise((r) => setTimeout(r, 600))

      console.log('[LiquidAuth][DEBUG] Authenticate: Creating SignalClient post-assertion')
      const client = signal.createSignalClient(baseUrl, {
        onLink: () => {
          setLinkReady(true)
          if (progress === 'linking') setProgress('idle')
          console.log('[LiquidAuth][DEBUG] SignalClient linked (authenticate)')
        },
      })
      setSignalClient(client)
      console.log('[LiquidAuth][DEBUG] Authenticate: Starting peer post-assertion')
      await startSignalFlow(client, reqId)
    } catch (e) {
      logger.error('[LiquidAuth][Settings] Assertion error', { error: e as unknown as Record<string, unknown> })
      setError((e as Error).message)
      setProgress('failed')
      console.log('[LiquidAuth][DEBUG] Authenticate: Error', e)
    } finally {
      setLoading(null)
    }
  }, [origin, hdWalletService, dp256PublicKey, dp256PrivateKey, address, liquidAuthSignalingUrl, linkReady, signalClient, fetchRequestId, startSignalFlow])

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.container}>
      <View>
        <ThemedText style={[TextTheme.normal, styles.paragraph]}>
          Intermezzo Pawn Endpoint:
        </ThemedText>

        <TextInput
          value={pawnEndpoint}
          onChangeText={setPawnEndpoint}
          placeholder="Pawn Endpoint (e.g. https://pawn.example.com)"
          placeholderTextColor={ColorPalette.grayscale.mediumGrey}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
          accessibilityLabel="Pawn Endpoint"
          testID="PawnEndpointInput"
        />
        <ThemedText style={[TextTheme.normal, styles.paragraph]}>
          Liquid Auth Signaling Server:
        </ThemedText>
        <TextInput
          value={liquidAuthSignalingUrl}
          onChangeText={setliquidAuthSignalingUrl}
          placeholder="https://your-backend.example.com/health"
          placeholderTextColor={ColorPalette.grayscale.mediumGrey}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
          accessibilityLabel="Backend URL"
          testID="liquidAuthSignalingUrlInput"
        />

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onRegister}
            disabled={!!loading}
            style={[styles.button, loading ? styles.buttonDisabled : undefined]}
            accessibilityLabel="Register"
            testID="LiquidAuthRegisterButton"
          >
            {loading === 'register' ? (
              <ActivityIndicator color={ColorPalette.grayscale.white} />
            ) : (
              <ThemedText style={{ color: ColorPalette.grayscale.white }}>Register</ThemedText>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onAuthenticate}
            disabled={!!loading}
            style={[styles.button, loading ? styles.buttonDisabled : undefined]}
            accessibilityLabel="Authenticate"
            testID="LiquidAuthAuthenticateButton"
          >
            {loading === 'authenticate' ? (
              <ActivityIndicator color={ColorPalette.grayscale.white} />
            ) : (
              <ThemedText style={{ color: ColorPalette.grayscale.white }}>Authenticate</ThemedText>
            )}
          </TouchableOpacity>
        </View>

        {!!error && (
          <View style={styles.resultBox}>
            <ThemedText style={[TextTheme.normal]}>{error}</ThemedText>
          </View>
        )}
        {!!result && (
          <View style={styles.resultBox}>
            <ThemedText style={[TextTheme.normal]}>{result}</ThemedText>
          </View>
        )}
        {lastSignalMessage ? <Text style={{ marginTop: 8 }}>{`Last signal message: ${lastSignalMessage}`}</Text> : null}
        {signalError ? <Text style={{ marginTop: 8, color: '#D00' }}>{`Signal error: ${signalError}`}</Text> : null}
      </View>
    </SafeAreaView>
  )
}

export default LiquidAuthSettings
