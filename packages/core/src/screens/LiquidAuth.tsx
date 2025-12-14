import React, { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { StackScreenProps } from '@react-navigation/stack'
import { useTranslation } from 'react-i18next'
import { DeliveryStackParams, Screens } from '../types/navigators'
import { isAlgorandHDWalletAvailable, createAlgorandHDWalletService } from '../services/algorandHDWallet'
import { hasHDWalletKey, generateAndStoreHDWalletKey } from '../services/hdWalletKeychain'
import { loadMnemonic } from '../services/keychain'
import { Stacks } from '../types/navigators'
import { DeterministicP256 } from '@algorandfoundation/dp256'
import type { HDWalletService } from '../modules/hd-wallet/hdWalletUtils'
import { parseLiquidAuthURI } from '../utils/parsers'

import { SignalClient } from '@algorandfoundation/liquid-client/lib/signal'
import { toBase64URL, fromBase64Url } from '@algorandfoundation/liquid-client/lib/encoding'
import { encodeAddress } from '../modules/hd-wallet/hdWalletUtils'
import {
  requestAttestationOptions,
  buildRegistrationCredential,
  submitAttestationResponse,
} from '../modules/liquid-auth/register'
import type { AttestationRequestOptions } from '../modules/liquid-auth/register'
import {
  requestAssertionOptions,
  buildAssertionCredential,
  submitAssertionResponse,
} from '../modules/liquid-auth/assertion'
import { sha256 } from '@noble/hashes/sha2'
// import DeviceInfo from 'react-native-device-info'

type Props = StackScreenProps<DeliveryStackParams, Screens.LiquidAuth>

// TURN credentials (aligns with iOS setup)
const NODELY_TURN_USERNAME = 'liquid-auth'
const NODELY_TURN_CREDENTIAL = 'sqmcP4MiTKMT4TGEDSk9jgHY'

type ProgressPhase =
  | 'idle'
  | 'preparing-keys'
  | 'linking'
  | 'registering'
  | 'starting-peer'
  | 'connecting'
  | 'connected'
  | 'failed'

const LiquidAuth: React.FC<Props> = ({ route, navigation }) => {
  const { uri } = route.params
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [address, setAddress] = useState<string | undefined>()
  const [dp256PubLen, setDp256PubLen] = useState<number | undefined>()
  const [dp256PublicKey, setDp256PublicKey] = useState<Uint8Array | undefined>()
  const [dp256SigLen, setDp256SigLen] = useState<number | undefined>()
  // TODO: re-derive on-the-fly as needed in both registrate and authenticate flows
  const [dp256PrivateKey, setDp256PrivateKey] = useState<any | null>(null)
  const [origin, setOrigin] = useState<string | undefined>()
  const [requestId, setRequestId] = useState<string | undefined>()
  const [signalClient, setSignalClient] = useState<SignalClient | null>(null)
  const [hdWalletService, setHdWalletService] = useState<HDWalletService | null>(null)
  const [progress, setProgress] = useState<ProgressPhase>('idle')
  const [linkReady, setLinkReady] = useState<boolean>(false)
  const isStartingPeerRef = useRef(false)
  const [lastSignalMessage, setLastSignalMessage] = useState<string | undefined>()
  const [signalError, setSignalError] = useState<string | undefined>()

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
                setError(t('LiquidAuth.InvalidURI'))
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
            const payload = new TextEncoder().encode('liquid-auth bootstrap')
            const signature = dp256.signWithDomainSpecificKeyPair(privateKey, payload)

            // console.log("signature")

            if (mounted) {
              setDp256PubLen(publicKeyBytes.length)
              setDp256PublicKey(publicKeyBytes)
              setDp256SigLen(signature.length)
              setDp256PrivateKey(privateKey)
            }

            // Initialize SignalClient with a valid scheme (required by fetch in attestation)
            const baseUrl = parsed.origin.startsWith('http') ? parsed.origin : `https://${parsed.origin}`
            const client = new SignalClient(baseUrl, { autoConnect: true })

            // mark link readiness when server acknowledges link
            client.on('link', () => {
              // console.log('[SignalClient] link event acknowledged')
              setLinkReady(true)
              // if we were showing linking, revert to idle until user registers
              if (progress === 'linking') setProgress('idle')
            })
            setSignalClient(client)

            // Pre-link on screen load so the browser peer is associated early
            try {
              if (parsed.requestId) {
                // console.log('[SignalClient] pre-linking request on load', parsed.requestId)
                setProgress('linking')
                setLinkReady(false)
                await client.link(parsed.requestId)
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
    if (!origin || !requestId || !hdWalletService) return
    // Proceed with registration

    try {
      // Normalize service origin to include scheme
      const baseUrl = `https://${origin}`
      const publicKeyBytes: Uint8Array = await hdWalletService.generateAlgorandAddressKey(0, 0)
      const algorandAddress = encodeAddress(publicKeyBytes)

      // Use a distinct registering phase to avoid bouncing back to "Preparing keys…"
      setProgress('registering')
      const requestOptions: AttestationRequestOptions = {
        username: algorandAddress,
        displayName: 'Liquid Auth User',
        authenticatorSelection: { userVerification: 'required' },
        extensions: { liquid: true },
      }
      // TODO: customize user-agent string with device info
      const userAgent = 'liquid-auth/1.0 (iPhone; iOS 18.5)'
      const encodedOptions = await requestAttestationOptions(baseUrl, userAgent, requestOptions)

      // Prepare PublicKeyCredentialCreationOptions
      const options: any = { ...encodedOptions }
      options.user = options.user || {}
      // Generate Algorand address public key bytes and encoded address on the fly
      options.user.id = publicKeyBytes
      options.user.name = algorandAddress
      options.user.displayName = 'Rocca Mobile Wallet'
      options.challenge = fromBase64Url(options.challenge)
      if (options.excludeCredentials) {
        for (const cred of options.excludeCredentials) {
          cred.id = fromBase64Url(cred.id)
        }
      }

      // Sign challenge using Algorand HD wallet key
      const challenge: Uint8Array = options.challenge
      const sigBytes = await hdWalletService.signChallengeBytes(0, 0, challenge)
      if (!dp256PublicKey || dp256PublicKey.length === 0)
        throw new Error('Passkey not initialized: dp256 public key unavailable')
      const { credential } = buildRegistrationCredential({
        encodedOptions,
        originHost: origin!,
        dp256PublicKey,
        algorandAddress,
        algorandPublicKeyBytes: publicKeyBytes,
        requestId,
        signatureBytes: sigBytes,
      })

      const { ok, status } = await submitAttestationResponse(baseUrl, userAgent, credential)
      if (!ok) throw new Error(`Attestation failed: HTTP ${status}`)

      // Cooldown to allow server to finalize session before starting peer
      await new Promise((r) => setTimeout(r, 600))

      // Ensure link is acknowledged before starting peer
      if (!linkReady && signalClient) {
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
  const startSignalFlow = (client: SignalClient, reqId: string) => {
    // console.log("Trying to create SignalClient peer connection", { origin, requestId: reqId })
    if (isStartingPeerRef.current) {
      // console.log('[SignalClient] peer start already in progress; skipping duplicate')
      return
    }
    isStartingPeerRef.current = true
    setProgress('starting-peer')

    // console.log('[SignalClient] starting peer')
    client
      .peer(reqId, 'answer', {
        iceServers: [
          {
            urls: [
              'stun:stun.l.google.com:19302',
              'stun:stun1.l.google.com:19302',
              'stun:stun2.l.google.com:19302',
              'stun:stun3.l.google.com:19302',
              'stun:stun4.l.google.com:19302',
            ],
          },
          {
            urls: [
              'turn:global.turn.nodely.network:80?transport=tcp',
              'turns:global.turn.nodely.network:443?transport=tcp',
              'turn:eu.turn.nodely.io:80?transport=tcp',
              'turns:eu.turn.nodely.io:443?transport=tcp',
              'turn:us.turn.nodely.io:80?transport=tcp',
              'turns:us.turn.nodely.io:443?transport=tcp',
            ],
            username: NODELY_TURN_USERNAME,
            credential: NODELY_TURN_CREDENTIAL,
          },
        ],
        iceCandidatePoolSize: 10,
      })
      .then((dataChannel) => {
        setProgress('connected')
        dataChannel.onmessage = (event: MessageEvent) => {
          try {
            const msg = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
            setLastSignalMessage(msg)
          } catch {
            setLastSignalMessage('[unreadable message]')
          }
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setSignalError(message)
        setProgress('failed')
        // No auto-retry: let the flow settle, user can re-attempt
      })
      .finally(() => {
        isStartingPeerRef.current = false
      })
  }

  const onAuthenticate = async () => {
    if (!origin || !requestId || !hdWalletService || !dp256PublicKey) return

    try {
      const baseUrl = `https://${origin}`
      const userAgent = 'liquid-auth/1.0 (iPhone; iOS 18.5)'

      // Ensure link is acknowledged before auth
      // if (!linkReady && signalClient) {
      //   setProgress('linking')
      //   await new Promise<void>((resolve, reject) => {
      //     const timeout = setTimeout(() => reject(new Error('Link not ready')), 2000)
      //     const handler = () => { clearTimeout(timeout); resolve() }
      //     signalClient.once?.('link', handler as any)
      //   })
      //   setProgress('idle')
      // }
      if (!dp256PrivateKey) throw new Error('Passkey not initialized: dp256 private key unavailable')

      const signingPrivateKey = dp256PrivateKey
      const dp256 = new DeterministicP256()

      // Compute credentialId from dp256 public key
      const credId = toBase64URL(sha256(dp256PublicKey))

      // Request assertion options
      const encodedOptions = await requestAssertionOptions(baseUrl, userAgent, credId)

      // Prepare Algorand signature over challenge for liquidExt
      const challengeBytes: Uint8Array =
        typeof encodedOptions.challenge === 'string'
          ? fromBase64Url(encodedOptions.challenge)
          : encodedOptions.challenge
      const algSigBytes = await hdWalletService.signChallengeBytes(0, 0, challengeBytes)

      // Build assertion credential (DER signature)
      const { credential } = buildAssertionCredential({
        encodedOptions,
        originHost: origin,
        dp256Sign: (payload: Uint8Array) => dp256.signWithDomainSpecificKeyPair(signingPrivateKey, payload),
        toDer: (raw: Uint8Array) => dp256.rawToDER(raw),
        dp256PublicKey,
        algorandAddress: address!,
        requestId,
        algorandSignatureBytes: algSigBytes,
        userHandle: address!,
      })

      const liquidExt = {
        type: 'algorand',
        requestId,
        address: address!,
        signature: toBase64URL(algSigBytes),
        device: 'iPhone',
      }

      const { ok, status } = await submitAssertionResponse(baseUrl, userAgent, credential, liquidExt)
      if (!ok) throw new Error(`Assertion failed: HTTP ${status}`)
    } catch (e) {
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

      {/* Progress hint always reflects the current phase; initial loading uses Preparing keys… */}
      <Text style={styles.hint}>
        {progress === 'preparing-keys'
          ? 'Preparing keys…'
          : progress === 'linking'
          ? 'Linking…'
          : progress === 'registering'
          ? 'Registering…'
          : progress === 'starting-peer'
          ? 'Starting peer…'
          : progress === 'connecting'
          ? 'Connecting…'
          : progress === 'connected'
          ? 'Connected.'
          : progress === 'failed'
          ? 'Connection failed.'
          : loading
          ? 'Preparing keys…'
          : ''}
      </Text>
      {loading ? null : (
        <>
          {address ? (
            <Text style={styles.meta}>Algorand Address: {address}</Text>
          ) : (
            <Text style={styles.meta}>Algorand Address: unavailable</Text>
          )}
          {typeof dp256PubLen === 'number' ? (
            <Text style={styles.meta}>Passkey P-256 Public Key Length: {dp256PubLen} bytes</Text>
          ) : (
            <Text style={styles.meta}>Passkey P-256: unavailable</Text>
          )}
          {typeof dp256SigLen === 'number' ? (
            <Text style={styles.meta}>Sample Signature Length: {dp256SigLen} bytes</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}

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

export default LiquidAuth
