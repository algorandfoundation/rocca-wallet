import React, { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { StackScreenProps } from '@react-navigation/stack'
import { useTranslation } from 'react-i18next'
import { DeliveryStackParams, Screens, Stacks } from '../types/navigators'
import { isAlgorandHDWalletAvailable, createAlgorandHDWalletService } from '../services/algorandHDWallet'
import { hasHDWalletKey, generateAndStoreHDWalletKey } from '../services/hdWalletKeychain'
import { loadMnemonic } from '../services/keychain'
import { DeterministicP256 } from '@algorandfoundation/dp256'
import type { HDWalletService } from '../modules/hd-wallet/hdWalletUtils'
import { parseLiquidAuthURI } from '../utils/parsers'

import * as signal from '../modules/liquid-auth/signal'
import { encodeAddress } from '../modules/hd-wallet/hdWalletUtils'
import { runAttestationFlow } from '../modules/liquid-auth/register'
import type { AttestationRequestOptions } from '../modules/liquid-auth/register'
import { runAssertionFlow } from '../modules/liquid-auth/assertion'
import { bifoldLoggerInstance as logger } from '../services/bifoldLogger'
// import DeviceInfo from 'react-native-device-info'

type Props = StackScreenProps<DeliveryStackParams, Screens.LiquidAuthScan>

type ProgressPhase =
  | 'idle'
  | 'preparing-keys'
  | 'linking'
  | 'registering'
  | 'starting-peer'
  | 'connecting'
  | 'connected'
  | 'failed'

const LiquidAuthScan: React.FC<Props> = ({ route, navigation }) => {
  const { uri } = route.params
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [address, setAddress] = useState<string | undefined>()
  const [dp256PublicKey, setDp256PublicKey] = useState<Uint8Array | undefined>()
  // TODO: re-derive on-the-fly as needed in both registrate and authenticate flows
  const [dp256PrivateKey, setDp256PrivateKey] = useState<any | null>(null)
  const [origin, setOrigin] = useState<string | undefined>()
  const [requestId, setRequestId] = useState<string | undefined>()
  const [signalClient, setSignalClient] = useState<signal.SignalClient | null>(null)
  const [hdWalletService, setHdWalletService] = useState<HDWalletService | null>(null)
  const [progress, setProgress] = useState<ProgressPhase>('idle')
  const [linkReady, setLinkReady] = useState<boolean>(false)
  const isStartingPeerRef = useRef(false)
  const [lastSignalMessage, setLastSignalMessage] = useState<string | undefined>()
  const [signalError, setSignalError] = useState<string | undefined>()
  const [attemptedAction, setAttemptedAction] = useState<'register' | 'authenticate' | null>(null)

  useEffect(() => {
    let mounted = true
    const run = async () => {
      try {
        setLoading(true)
        setError(undefined)

        // Ensure mnemonic / HD wallet is available
        const available = await isAlgorandHDWalletAvailable()
        if (!available) {
          // Recovery phrase not set: update UI state before redirecting
          if (mounted) {
            setError('Recovery phrase not set. Redirecting to setup...')
            setLoading(false)
          }
          // Navigate to Set Mnemonics to initialize
          navigation.navigate(Stacks.SettingStack as any, { screen: Screens.SetMnemonics })
          return
        }

        // If only mnemonic exists (no stored root key), derive and store root key now
        const hasKey = await hasHDWalletKey()
        if (!hasKey) {
          const mnemonic = await loadMnemonic()
          if (mnemonic) {
            try {
              await generateAndStoreHDWalletKey(mnemonic)
            } catch (storeErr) {
              // Non-fatal: we can still derive on-the-fly later
              // console.log('[LiquidAuth] generateAndStoreHDWalletKey error', storeErr)
            }
          }
        }

        // Initialize HD wallet service and derive Algorand address via public key bytes
        const hd = await createAlgorandHDWalletService()
        if (mounted) setHdWalletService(hd)
        if (hd) {
          const publicKeyBytes = await hd.generateAlgorandAddressKey(0, 0)
          const addrStr = encodeAddress(publicKeyBytes)
          if (mounted) setAddress(addrStr)
        }

        // Generate a deterministic P-256 passkey using BIP39 via dp256
        try {
          const mnemonic = await loadMnemonic()
          if (mnemonic) {
            const dp256 = new DeterministicP256()

            // Derive main key from BIP39 phrase. The default (210k) is CPU-heavy and
            // will block the RN JS thread. Use fewer iterations in dev to keep UI responsive.
            const salt = new TextEncoder().encode('liquid')
            // TODO: test 210k iterations on real device performance
            // TODO: MOVE THIS TO USER ONBOARDING/MNEMONIC ADDITION FLOW!
            const iterations = (global as any).__DEV__ ? 10 : 210_000
            const derivedKey = await dp256.genDerivedMainKeyWithBIP39(mnemonic, salt, iterations, 512)

            // Extract origin and requestId from liquid:// URI (requestId required)
            const parsed = parseLiquidAuthURI(uri)
            if (!parsed) {
              if (mounted) {
                setError(t('LiquidAuthScan.InvalidURI'))
                setLoading(false)
              }
              return
            }
            setOrigin(parsed.origin)
            setRequestId(parsed.requestId)
            const userHandle = address ?? 'anonymous@local'

            // Generate domain-specific passkey keypair and sample signature
            const privateKey = await dp256.genDomainSpecificKeyPair(derivedKey, parsed.origin, userHandle)
            const publicKeyBytes = dp256.getPurePKBytes(privateKey)

            // console.log("signature")

            if (mounted) {
              setDp256PublicKey(publicKeyBytes)
              setDp256PrivateKey(privateKey)
            }

            // Initialize SignalClient via wrapper
            const baseUrl = parsed.origin.startsWith('http') ? parsed.origin : `https://${parsed.origin}`
            const client = signal.createSignalClient(baseUrl, {
              onLink: () => {
                setLinkReady(true)
                if (progress === 'linking') setProgress('idle')
              },
            })
            setSignalClient(client)

            // Pre-link on screen load so the browser peer is associated early
            try {
              if (parsed.requestId) {
                // console.log('[SignalClient] pre-linking request on load', parsed.requestId)
                setProgress('linking')
                setLinkReady(false)
                await signal.preLink(client, parsed.requestId)
                // console.log('[SignalClient] pre-link requested')
                // linkReady will be set on 'link' event or grace timeout
              }
            } catch (e) {
              // console.log('[SignalClient] pre-link failed:', e)
              setProgress('failed')
              setLinkReady(false)
            }
          }
        } catch (pkErr) {
          if (mounted) setError((pkErr as Error).message)
        }
      } catch (e) {
        if (mounted) setError((e as Error).message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, uri])

  const onRegister = async () => {
    setAttemptedAction('register')
    if (!origin || !requestId || !hdWalletService) return
    // Proceed with registration

    try {
      // Normalize service origin to include scheme
      const baseUrl = `https://${origin}`
      const publicKeyBytes: Uint8Array = await hdWalletService.generateAlgorandAddressKey(0, 0)
      const algorandAddress = encodeAddress(publicKeyBytes)
      logger.info('[LiquidAuth][Scan] Attestation start', {
        baseUrl,
        origin,
        requestId,
        algorandAddress,
        linkReady,
      })

      // Use a distinct registering phase to avoid bouncing back to "Preparing keys…"
      setProgress('registering')
      const requestOptions: AttestationRequestOptions = {
        username: algorandAddress,
        displayName: 'Liquid Auth User',
        authenticatorSelection: { userVerification: 'required' },
        extensions: { liquid: true },
      }
      const userAgent = 'liquid-auth/1.0 (iPhone; iOS 18.5)'
      const { ok, status } = await runAttestationFlow({
        baseUrl,
        userAgent,
        originHost: origin!,
        dp256PublicKey: dp256PublicKey!,
        algorandAddress,
        algorandPublicKeyBytes: publicKeyBytes,
        requestId,
        device: 'iPhone',
        requestOptions,
        signAlgorandChallenge: (bytes) => hdWalletService.signChallengeBytes(0, 0, bytes),
      })
      logger.info('[LiquidAuth][Scan] Attestation response', { ok, status })
      if (!ok) throw new Error(`Attestation failed: HTTP ${status}`)

      // Cooldown to allow server to finalize session before starting peer
      await new Promise((r) => setTimeout(r, 600))

      // Ensure link is acknowledged before starting peer
      if (!linkReady && signalClient) {
        logger.debug('[LiquidAuth][Scan] Link not ready after attestation; waiting up to 2s for link event')
        setProgress('linking')
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Link not ready')), 2000)
          const handler = () => {
            clearTimeout(timeout)
            resolve()
          }
          signalClient.once?.('link', handler as any)
        })
        setProgress('idle')
      }
    } catch (e) {
      logger.error('[LiquidAuth][Scan] Attestation error', { error: e as unknown as Record<string, unknown> })
      setError((e as Error).message)
      setProgress('failed')
    }

    // Signal

    if (!signalClient) {
      setError('SignalClient not initialized')
      return
    }

    startSignalFlow(signalClient, requestId)
  }

  // Decoupled signaling flow
  const startSignalFlow = (client: signal.SignalClient, reqId: string) => {
    // console.log("Trying to create SignalClient peer connection", { origin, requestId: reqId })
    if (isStartingPeerRef.current) {
      // console.log('[SignalClient] peer start already in progress; skipping duplicate')
      return
    }
    isStartingPeerRef.current = true
    logger.debug('[LiquidAuth][Scan] Starting peer', { reqId, origin, linkReady })
    setProgress('starting-peer')

    signal
      .startPeer(client, reqId, {
        onConnected: () => {
          logger.info('[LiquidAuth][Scan] Peer connected')
          setProgress('connected')
        },
        onMessage: (m) => {
          logger.debug('[LiquidAuth][Scan] Signal message', { m })
          setLastSignalMessage(m)
        },
        onError: (e) => {
          logger.error('[LiquidAuth][Scan] Signal error', { error: e as unknown as Record<string, unknown> })
          setSignalError(e)
          setProgress('failed')
        },
      })
      .finally(() => {
        isStartingPeerRef.current = false
      })
  }

  const onAuthenticate = async () => {
    setAttemptedAction('authenticate')
    if (!origin || !requestId || !hdWalletService || !dp256PublicKey) return

    try {
      const baseUrl = `https://${origin}`
      const userAgent = 'liquid-auth/1.0 (iPhone; iOS 18.5)'


      if (!dp256PrivateKey) throw new Error('Passkey not initialized: dp256 private key unavailable')

      const signingPrivateKey = dp256PrivateKey
      const dp256 = new DeterministicP256()
      logger.info('[LiquidAuth][Scan] Assertion start', {
        baseUrl,
        origin,
        requestId,
        address,
        linkReady,
      })
      const { ok, status } = await runAssertionFlow({
        baseUrl,
        userAgent,
        originHost: origin!,
        dp256PublicKey: dp256PublicKey!,
        dp256Sign: (payload: Uint8Array) => dp256.signWithDomainSpecificKeyPair(signingPrivateKey, payload),
        toDer: (raw: Uint8Array) => dp256.rawToDER(raw),
        address: address!,
        requestId,
        device: 'iPhone',
        signAlgorandChallenge: (bytes) => hdWalletService.signChallengeBytes(0, 0, bytes),
      })
      logger.info('[LiquidAuth][Scan] Assertion response', { ok, status })
      if (!ok) throw new Error(`Assertion failed: HTTP ${status}`)
    } catch (e) {
      logger.error('[LiquidAuth][Scan] Assertion error', { error: e as unknown as Record<string, unknown> })
      setError((e as Error).message)
      setProgress('failed')
      return
    }

    // Signal
    if (!signalClient) {
      setError('SignalClient not initialized')
      return
    }
    startSignalFlow(signalClient, requestId)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Liquid Auth</Text>
      <Text style={styles.label}>Scanned URI:</Text>
      <Text selectable style={styles.uri}>
        {uri}
      </Text>

      {loading ? null : attemptedAction ? (
        <View style={styles.actions}>
          <View style={styles.messageArea}>
            {lastSignalMessage ? (
              <Text style={styles.meta}>Last signal message: {lastSignalMessage}</Text>
            ) : (
              // Reserve space for incoming messages so layout doesn't jump
              <Text style={styles.metaPlaceholder} />
            )}
          </View>

          {progress === 'connected' ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.getParent()?.navigate(Stacks.ConnectStack, { screen: Screens.Scan, params: { defaultToConnect: true } })}
            >
              <Text style={styles.primaryButtonText}>Scan again</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.hint}>Waiting for data channel…</Text>
            </View>
          )}

          {signalError ? <Text style={styles.error}>Signal error: {signalError}</Text> : null}
        </View>
      ) : (
        <>
          {address ? (
            <Text style={styles.meta}>Algorand Address: {address}</Text>
          ) : (
            <Text style={styles.meta}>Algorand Address: unavailable</Text>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}

      {loading ? (
        <View style={{ marginTop: 24, alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : attemptedAction ? null : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryButton, !linkReady && styles.buttonDisabled]}
            onPress={onRegister}
            accessibilityRole="button"
            disabled={!linkReady}
          >
            <Text style={styles.primaryButtonText}>Register</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={onAuthenticate} accessibilityRole="button">
            <Text style={styles.secondaryButtonText}>Authenticate</Text>
          </TouchableOpacity>
          {lastSignalMessage ? <Text style={styles.meta}>Last signal message: {lastSignalMessage}</Text> : null}
          {signalError ? <Text style={styles.error}>Signal error: {signalError}</Text> : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  label: { fontSize: 14, color: '#666' },
  uri: { fontSize: 12, color: '#333', marginTop: 4 },
  actions: { marginTop: 24, gap: 12 },
  meta: { marginTop: 8, fontSize: 12, color: '#444' },
  hint: { marginTop: 8, fontSize: 12, color: '#666' },
  messageArea: { height: 80, justifyContent: 'center' },
  metaPlaceholder: { height: 20 },
  error: { marginTop: 8, fontSize: 12, color: '#D00' },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    borderColor: '#007AFF',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
})

export default LiquidAuthScan
