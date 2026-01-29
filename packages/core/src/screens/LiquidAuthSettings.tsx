import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { StackScreenProps } from '@react-navigation/stack'

import { ThemedText } from '../components/texts/ThemedText'
import { useTheme } from '../contexts/theme'
import { Screens, SettingStackParams } from '../types/navigators'
import { isAlgorandHDWalletAvailable, createAlgorandHDWalletService } from '../modules/algorand/algorandHDWallet'
import { hasHDWalletKey, generateAndStoreHDWalletKey } from '../services/hdWalletKeychain'
import { loadMnemonic } from '../services/keychain'
import { DeterministicP256 } from '@algorandfoundation/dp256'
import { loadDp256MainKey } from '../services/hdWalletKeychain'
import type { HDWalletService } from '../modules/hd-wallet/hdWalletUtils'
import * as signal from '../modules/liquid-auth/signal'
import { encodeAddress } from '../modules/hd-wallet/hdWalletUtils'
import { createGroupTxnToSign, broadcastSignedGroupTxn } from '../modules/algorand/transactions'
import { fromBase64Url, toBase64URL } from '@algorandfoundation/liquid-client'
import { runAttestationFlow } from '../modules/liquid-auth/register'
import type { AttestationRequestOptions } from '../modules/liquid-auth/register'
import { runAssertionFlow } from '../modules/liquid-auth/assertion'
import { bifoldLoggerInstance as logger } from '../services/bifoldLogger'
import getUserAgent from '../modules/liquid-auth/userAgent'
import { encodeTransaction } from '@algorandfoundation/algokit-utils/transact'

type Props = StackScreenProps<SettingStackParams, Screens.LiquidAuthSettings>

const LiquidAuthSettings: React.FC<Props> = () => {
  useTranslation()
  const { ColorPalette, TextTheme } = useTheme()

  const [liquidAuthSignalingUrl, setliquidAuthSignalingUrl] = useState<string>('https://beetle-never.ngrok-free.app')//'https://debug.liquidauth.com')
  const [pawnEndpoint, setPawnEndpoint] = useState<string>('https://worm-different.ngrok.dev')
  // Helper to fetch requestId from Pawn Endpoint
  const fetchRequestId = useCallback(async () => {
    if (!pawnEndpoint) throw new Error('Pawn Endpoint is required')
    const url = `${pawnEndpoint.replace(/\/$/, '')}/v1/liquid/start`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch from Pawn Endpoint: ${res.status}`)
    const data = await res.json()
    if (!data.requestId) throw new Error('No requestId in Pawn Endpoint response')
    return data.requestId
  }, [pawnEndpoint])
  const [loading, setLoading] = useState<'register' | 'authenticate' | null>(null)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [address, setAddress] = useState<string | undefined>()
  const [dp256PublicKey, setDp256PublicKey] = useState<Uint8Array | undefined>()
  const [dp256PrivateKey, setDp256PrivateKey] = useState<any | null>(null)
  const [origin, setOrigin] = useState<string | undefined>()
  const [hdWalletService, setHdWalletService] = useState<HDWalletService | null>(null)
  const [, setProgress] = useState<
    'idle' | 'linking' | 'registering' | 'authenticating' | 'starting-peer' | 'connected' | 'failed'
  >('idle')
  const isStartingPeerRef = useRef(false)
  const [lastSignalMessage, setLastSignalMessage] = useState<string | undefined>()
  const [signalError, setSignalError] = useState<string | undefined>()
  const awaitingPawnSignatureRef = useRef(false)
  const pendingGroupTxnsRef = useRef<any[] | null>(null)
  const pendingRoccaSigRef = useRef<Uint8Array | null>(null)
  const pendingPawnAddrRef = useRef<string | null>(null)
  const [queuedPawnAddress, setQueuedPawnAddress] = useState<string | null>(null)
  const signalClientRef = useRef<signal.SignalClient | null>(null)

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
        // Ensure mnemonic / HD wallet is available
        const available = await isAlgorandHDWalletAvailable()
        logger.info('[LiquidAuth][Settings] HD wallet availability check', { available })
        if (!available) {
          setError('Recovery phrase not set. Please set your recovery phrase first.')
          return
        }
        const hasKey = await hasHDWalletKey()
        logger.info('[LiquidAuth][Settings] hasHDWalletKey', { hasKey })
        if (!hasKey) {
          const mnemonic = await loadMnemonic()
          logger.info('[LiquidAuth][Settings] loadMnemonic result', { hasMnemonic: !!mnemonic })
          if (mnemonic) {
            try {
              await generateAndStoreHDWalletKey(mnemonic)
            } catch {
              // continue
            }
          }
        }
        let hd: HDWalletService | null = null
        try {
          hd = await createAlgorandHDWalletService()
        } catch (e) {
          logger.error('[LiquidAuth][Settings] createAlgorandHDWalletService threw', { error: e as unknown as Record<string, unknown> })
        }
        logger.info('[LiquidAuth][Settings] createAlgorandHDWalletService result', { hdPresent: !!hd })
        if (mounted) setHdWalletService(hd)
        // Require Algorand address for dp256 derivation. Fail early if
        // the HD wallet service or address cannot be obtained — we do
        // not allow falling back to an anonymous handle.
        if (!hd) {
          const msg = 'HD wallet service unavailable; cannot derive Algorand address.'
          logger.error('[LiquidAuth][Settings] Missing HD wallet service', { message: msg })
          if (mounted) {
            setError(msg)
            setProgress('failed')
          }
          return
        }
        const publicKeyBytes = await hd.generateAlgorandAddressKey(0, 0)
        const addrStr = encodeAddress(publicKeyBytes)
        const userHandle = addrStr
        if (mounted) setAddress(addrStr)
        // dp256 derivation
        const mnemonic = await loadMnemonic()
        if (mnemonic) {
          const dp256 = new DeterministicP256()

          // REQUIRE: dp256 derived main key must be present (derived at onboarding)
          const derivedKey = await loadDp256MainKey()
          if (!derivedKey) {
            const msg = 'Missing dp256 derived main key. Complete onboarding or restore your recovery phrase.'
            logger.error('[LiquidAuth][Settings] Missing dp256 derived main key', { message: msg })
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
          const algorandAddressForUser = userHandle ?? address
          if (!algorandAddressForUser) {
            const msg = 'Algorand address unavailable for dp256 derivation.'
            logger.error('[LiquidAuth][Settings] Missing Algorand address for dp256', { message: msg })
            if (mounted) {
              setError(msg)
              setProgress('failed')
            }
            return
          }
          const privateKey = await dp256.genDomainSpecificKeyPair(derivedKey, originHost, algorandAddressForUser)
          const publicKeyBytes = dp256.getPurePKBytes(privateKey)
          if (mounted) {
            setDp256PublicKey(publicKeyBytes)
            setDp256PrivateKey(privateKey)
          }
          // SignalClient is not created here; we delay it until after
          // attestation/assertion so that the HTTP session (connect.sid)
          // is established and can be forwarded to the signaling server.
        }
      } catch (e) {
        setError((e as Error).message)
        logger.error('[LiquidAuth][Settings] Initialization error', { error: e as unknown as Record<string, unknown> })
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [address, liquidAuthSignalingUrl])

  const startSignalFlow = React.useCallback(
    async (client: signal.SignalClient, reqId: string) => {
      // remember client for queued processing
      signalClientRef.current = client
      if (isStartingPeerRef.current) return
      isStartingPeerRef.current = true

      // Backend (Pawn) already linked when it created requestId with peer(..., 'offer')
      // Mobile just needs to call peer(..., 'answer') without additional link()

      setProgress('starting-peer')
      return signal
        .startPeer(client, reqId, {
          onConnected: () => {
            setProgress('connected')
          },
          onMessage: (m) => {
            // Detect initial peer address message
            let parsed: any = null
            try {
              parsed = JSON.parse(m as string)
            } catch (e) {
              parsed = null
            }

            if (parsed) {
              const addr = typeof parsed.my_address === 'string' ? parsed.my_address : typeof parsed.address === 'string' ? parsed.address : undefined
              if (addr) {
                setLastSignalMessage(`peer address: ${addr}`)
                logger.info('[LiquidAuth][Settings] received peer address', { address: addr })
                // Immediate diagnostics to capture race conditions where hdWallet or client
                // may not yet be ready when the peer address arrives.
                try {
                  const hasHd = !!hdWalletService
                  const hasAddr = !!address
                  const clientRef = signalClientRef.current || client
                  const hasClientRef = !!clientRef
                  // Console log so it appears reliably in runtime logs
                  // and set a short UI message for quick visibility
                  // This will help confirm whether the HD wallet was truly initialized
                  // when the pawn address arrived.
                  // eslint-disable-next-line no-console
                  console.log('[LiquidAuth][Settings][DIAG] onMessage', { hasHd, hasAddr, hasClientRef })
                  setLastSignalMessage(`diag: hd=${hasHd} addr=${hasAddr} client=${hasClientRef}`)
                } catch (diagErr) {
                  // ignore
                }

                // If wallet and client ready, process immediately; otherwise queue
                const clientRef = signalClientRef.current || client
                if (!hdWalletService || !address || !clientRef) {
                  pendingPawnAddrRef.current = addr
                  setQueuedPawnAddress(addr)
                  logger.info('[LiquidAuth][Settings] queued peer address until wallet/client ready', { address: addr })
                  setLastSignalMessage(`peer address queued: ${addr}`)
                  return
                }
                // process immediately
                logger.info('[LiquidAuth][Settings] processing peer address now', { address: addr })
                setLastSignalMessage(`processing peer address: ${addr}`)
                processPawnAddress(addr, clientRef)
                return
              }
            }

            // If we are awaiting the pawn's signature, treat non-JSON message as the signature
            if (awaitingPawnSignatureRef.current) {
              ; (async () => {
                try {
                  const raw = (m as string)

                  // Pawn may send either a raw base64url string or a JSON payload
                  // like { sig: "..." } or { signature: "..." } or { stxns: ["..."] }
                  let sigStr: string | null = null
                  try {
                    const parsed = JSON.parse(raw)
                    if (typeof parsed === 'string') {
                      sigStr = parsed
                    } else if (parsed && typeof parsed === 'object') {
                      if (typeof parsed.sig === 'string') sigStr = parsed.sig
                      else if (typeof parsed.signature === 'string') sigStr = parsed.signature
                      else if (typeof parsed.bytesToSign === 'string') sigStr = parsed.bytesToSign
                      else if (Array.isArray(parsed.stxns) && typeof parsed.stxns[0] === 'string') sigStr = parsed.stxns[0]
                      else if (typeof parsed.stxn === 'string') sigStr = parsed.stxn
                      else {
                        // fallback: find first string leaf in the object
                        const findString = (obj: any): string | null => {
                          if (!obj || typeof obj !== 'object') return null
                          for (const k of Object.keys(obj)) {
                            const v = obj[k]
                            if (typeof v === 'string') return v
                            if (v && typeof v === 'object') {
                              const r = findString(v)
                              if (r) return r
                            }
                          }
                          return null
                        }
                        sigStr = findString(parsed)
                      }
                    }
                  } catch (e) {
                    // not JSON, treat raw as the signature string
                    sigStr = raw
                  }

                  if (!sigStr) throw new Error('No signature string found in pawn message')

                  // decode pawn signature (expect base64url)
                  const pawnSig = fromBase64Url(sigStr)
                  const groupTxns = pendingGroupTxnsRef.current
                  if (!groupTxns) {
                    logger.error('[LiquidAuth][Settings] no pending group txns when pawn signature arrived')
                    return
                  }

                  // assemble signed transactions
                  const stxn1: any = { txn: groupTxns[0], sig: pawnSig }
                  const stxn2: any = { txn: groupTxns[1], sig: pendingRoccaSigRef.current }

                  try {
                    const res = await broadcastSignedGroupTxn([stxn1, stxn2])
                    setLastSignalMessage(`Group transaction successfully broadcast: ${res.txId}`)
                  } catch (e) {
                    logger.error('[LiquidAuth][Settings] broadcast failed', { error: e as unknown as Record<string, unknown> })
                    setLastSignalMessage('Broadcast failed')
                  }
                } catch (err) {
                  logger.error('[LiquidAuth][Settings] error handling pawn signature', { error: err as unknown as Record<string, unknown> })
                } finally {
                  awaitingPawnSignatureRef.current = false
                  pendingGroupTxnsRef.current = null
                  pendingRoccaSigRef.current = null
                }
              })()
              return
            }

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
    },
    [hdWalletService, address, setProgress, setLastSignalMessage, setSignalError]
  )

  // Processor for pawn address; extracted so it can be invoked from queued state
  const processPawnAddress = async (pawnAddr: string, client: signal.SignalClient) => {
    try {
      if (!hdWalletService || !address) {
        logger.error('[LiquidAuth][Settings] Missing HD wallet or address for txn signing')
        return
      }

      const roccaAddr = address
      // Create group txns
      const groupTxns = await createGroupTxnToSign(roccaAddr, pawnAddr)
      if (!groupTxns || groupTxns.length < 2) {
        logger.error('[LiquidAuth][Settings] createGroupTxnToSign returned invalid txns')
        return
      }

      pendingGroupTxnsRef.current = groupTxns

      // Sign rocca's txn (index 1)
      const txnToSignByRocca = groupTxns[1]
      const encodedRoccaTxn = encodeTransaction(txnToSignByRocca)
      const roccaSig = await hdWalletService.signAlgorandTransaction(0, 0, encodedRoccaTxn)
      pendingRoccaSigRef.current = roccaSig
      logger.info('[LiquidAuth][Settings] Rocca signed its txn', { address: roccaAddr })
      setLastSignalMessage(`Rocca signed its txn; preparing pawn payload for ${pawnAddr}`)

      // Send pawn's txn (index 0) over the data channel as base64url
      const txnForPawn = groupTxns[0]
      const encodedPawnTxn = encodeTransaction(txnForPawn)
      const pawnPayload = toBase64URL(encodedPawnTxn)
      // Send structured JSON so the Pawn side can parse the message reliably
      const payloadObj = { bytesToSign: pawnPayload }
      awaitingPawnSignatureRef.current = true
        ; (client as any).sendData?.(JSON.stringify(payloadObj))
    } catch (err) {
      logger.error('[LiquidAuth][Settings] error preparing/sending group txn', { error: err as unknown as Record<string, unknown> })
    }
  }

  // If a pawn address was queued earlier (before HD wallet / client ready),
  // process it once the HD wallet and signal client are available.
  useEffect(() => {
    const queued = queuedPawnAddress || pendingPawnAddrRef.current
    const client = signalClientRef.current
    if (queued && hdWalletService && client) {
      logger.info('[LiquidAuth][Settings] processing queued pawn address now', { address: queued })
      setLastSignalMessage(`processing queued peer address: ${queued}`)
      // clear the queued addr immediately to avoid re-processing
      pendingPawnAddrRef.current = null
      setQueuedPawnAddress(null)
      processPawnAddress(queued, client)
    }
  }, [hdWalletService])

  const onRegister = useCallback(async () => {
    if (!origin || !hdWalletService || !dp256PublicKey) return
    try {
      setLoading('register')
      setResult('')
      setError('')
      setProgress('registering')
      const reqId = await fetchRequestId()
      // Add 2 second delay after fetching requestId
      await new Promise((r) => setTimeout(r, 2000))
      const baseUrl = liquidAuthSignalingUrl
      const publicKeyBytes: Uint8Array = await hdWalletService.generateAlgorandAddressKey(0, 0)
      const algorandAddress = encodeAddress(publicKeyBytes)
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
      if (!ok) throw new Error(`Attestation failed: HTTP ${status}`)
      await new Promise((r) => setTimeout(r, 600))

      // Create SignalClient lazily after attestation so that it can
      // reuse the HTTP session (connect.sid) established above.
      const client = signal.createSignalClient(baseUrl, {
        onLink: () => {
          setProgress((p) => (p === 'linking' ? 'idle' : p))
        },
      })
      await startSignalFlow(client, reqId)
    } catch (e) {
      logger.error('[LiquidAuth][Settings] Attestation error', { error: e as unknown as Record<string, unknown> })
      setError((e as Error).message)
      setProgress('failed')
    } finally {
      setLoading(null)
    }
  }, [origin, hdWalletService, dp256PublicKey, liquidAuthSignalingUrl, fetchRequestId, startSignalFlow])

  const onAuthenticate = useCallback(async () => {
    if (!origin || !hdWalletService || !dp256PublicKey || !dp256PrivateKey || !address) return
    try {
      setLoading('authenticate')
      setError('')
      setResult('')
      setProgress('authenticating')
      const reqId = await fetchRequestId()
      // Add 2 second delay after fetching requestId
      await new Promise((r) => setTimeout(r, 2000))
      const baseUrl = liquidAuthSignalingUrl
      const userAgent = getUserAgent()
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
      if (!ok) throw new Error(`Assertion failed: HTTP ${status}`)
      await new Promise((r) => setTimeout(r, 600))

      const client = signal.createSignalClient(baseUrl, {
        onLink: () => {
          setProgress((p) => (p === 'linking' ? 'idle' : p))
        },
      })
      await startSignalFlow(client, reqId)
    } catch (e) {
      logger.error('[LiquidAuth][Settings] Assertion error', { error: e as unknown as Record<string, unknown> })
      setError((e as Error).message)
      setProgress('failed')
    } finally {
      setLoading(null)
    }
  }, [
    origin,
    hdWalletService,
    dp256PublicKey,
    dp256PrivateKey,
    address,
    liquidAuthSignalingUrl,
    fetchRequestId,
    startSignalFlow,
  ])

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.container}>
      <View>
        <ThemedText style={[TextTheme.normal, styles.paragraph]}>Intermezzo Pawn Endpoint:</ThemedText>

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
        <ThemedText style={[TextTheme.normal, styles.paragraph]}>Liquid Auth Signaling Server:</ThemedText>
        <TextInput
          value={liquidAuthSignalingUrl}
          onChangeText={setliquidAuthSignalingUrl}
          placeholder="https://your-backend.example.com/"
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
