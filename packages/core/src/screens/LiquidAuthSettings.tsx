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
import { createGroupTxnToSign, createSingleTxnToSign } from '../modules/algorand/transactions'
import { fromBase64Url, toBase64URL } from '@algorandfoundation/liquid-client'
import { runAttestationFlow } from '../modules/liquid-auth/register'
import type { AttestationRequestOptions } from '../modules/liquid-auth/register'
import { runAssertionFlow } from '../modules/liquid-auth/assertion'
import { bifoldLoggerInstance as logger } from '../services/bifoldLogger'
import getUserAgent from '../modules/liquid-auth/userAgent'
import { encodeTransaction, encodeSignedTransaction } from '@algorandfoundation/algokit-utils/transact'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import VerifyPINModal from '../components/modals/VerifyPINModal'
import { PINEntryUsage } from './PINVerify'
import InfoBox, { InfoBoxType } from '../components/misc/InfoBox'
import SafeAreaModal from '../components/modals/SafeAreaModal'

type Props = StackScreenProps<SettingStackParams, Screens.LiquidAuthSettings>

const LiquidAuthSettings: React.FC<Props> = () => {
  useTranslation()
  const { ColorPalette, TextTheme } = useTheme()

  const [liquidAuthSignalingUrl, setliquidAuthSignalingUrl] = useState<string>('https://debug.liquidauth.com')
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
  const [initDone, setInitDone] = useState(false)
  const [, setProgress] = useState<
    'idle' | 'linking' | 'registering' | 'authenticating' | 'starting-peer' | 'connected' | 'failed'
  >('idle')
  const isStartingPeerRef = useRef(false)
  const [lastSignalMessage, setLastSignalMessage] = useState<string | undefined>()
  const [signalError, setSignalError] = useState<string | undefined>()
  const awaitingPawnSignatureRef = useRef(false)
  const pendingGroupTxnsRef = useRef<any[] | null>(null)
  const pendingRoccaSigRef = useRef<Uint8Array | null>(null)
  const pendingPawnSigRef = useRef<string | null>(null)
  const pendingPawnProcessingRef = useRef(false)
  const pendingPawnAddrRef = useRef<string | null>(null)
  const [queuedPawnAddress, setQueuedPawnAddress] = useState<string | null>(null)
  const signalClientRef = useRef<signal.SignalClient | null>(null)

  const [pinModalVisible, setPinModalVisible] = useState(false)
  const pendingActionRef = useRef<(() => Promise<void>) | null>(null)

  const [confirmPawnModalVisible, setConfirmPawnModalVisible] = useState(false)
  const [confirmPawnAddress, setConfirmPawnAddress] = useState<string | null>(null)
  const [confirmPawnClient, setConfirmPawnClient] = useState<signal.SignalClient | null>(null)

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
      } finally {
        if (mounted) setInitDone(true)
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [address, liquidAuthSignalingUrl])

  // Process a pawn-provided signature (string). This is extracted so it
  // can be invoked either from the signal message handler or from
  // `processPawnAddress` if a signature arrived early.
  const processPawnSignature = useCallback(
    async (sigStrParam: string | null) => {
      try {
        if (pendingPawnProcessingRef.current) {
          // already processing a pawn signature; ignore duplicate
          return
        }
        pendingPawnProcessingRef.current = true
        // clear awaiting flag now that we're handling the signature
        awaitingPawnSignatureRef.current = false
        if (!sigStrParam) {
          logger.error('[LiquidAuth][Settings] processPawnSignature: empty signature')
          pendingPawnProcessingRef.current = false
          return
        }

        const groupTxns = pendingGroupTxnsRef.current
        if (!groupTxns) {
          // Nothing to sign against yet — buffer and return
          pendingPawnSigRef.current = sigStrParam
          return
        }

        // Ensure Rocca signature present — sign on-demand if missing
        let roccaSig = pendingRoccaSigRef.current
        if (!roccaSig) {
          if (!hdWalletService) {
            logger.error('[LiquidAuth][Settings][DIAG] hdWalletService unavailable when computing rocca signature')
          } else {
            const encodedRoccaTxn = encodeTransaction(groupTxns[1])
            const computed = await hdWalletService.signAlgorandTransaction(0, 0, encodedRoccaTxn)
            pendingRoccaSigRef.current = computed
            roccaSig = computed
          }
        }

        // Decode pawn signature (pawn sends base64url)
        let pawnSigBytes: Uint8Array | null = null
        try {
          pawnSigBytes = sigStrParam ? fromBase64Url(sigStrParam) : null
        } catch (e) {
          pawnSigBytes = null
        }

        let roccaSigBytes: Uint8Array | null = null
        if (roccaSig instanceof Uint8Array) {
          roccaSigBytes = roccaSig
        } else if (typeof roccaSig === 'string') {
          try {
            roccaSigBytes = fromBase64Url(roccaSig)
          } catch (e) {
            roccaSigBytes = null
          }
        } else if (typeof Buffer !== 'undefined' && roccaSig && Buffer.isBuffer(roccaSig)) {
          roccaSigBytes = new Uint8Array(roccaSig)
        }

        // Debug

        // Validate signatures
        if (!pawnSigBytes || pawnSigBytes.length !== 64) {
          logger.error('[LiquidAuth][Settings] missing or invalid pawn signature; aborting broadcast', { pawnSigBytesLength: pawnSigBytes?.length })
          setLastSignalMessage('Pawn signature missing or invalid; aborting')
          awaitingPawnSignatureRef.current = false
          pendingGroupTxnsRef.current = null
          pendingRoccaSigRef.current = null
          pendingPawnSigRef.current = null
          return
        }

        if (!roccaSigBytes || roccaSigBytes.length !== 64) {
          logger.error('[LiquidAuth][Settings] missing or invalid rocca signature; aborting broadcast', { roccaSigBytesLength: roccaSigBytes?.length })
          setLastSignalMessage('Rocca signature missing or invalid; aborting')
          awaitingPawnSignatureRef.current = false
          pendingGroupTxnsRef.current = null
          pendingRoccaSigRef.current = null
          pendingPawnSigRef.current = null
          return
        }

        const stxn1: any = { txn: groupTxns[0], sig: pawnSigBytes }
        const stxn2: any = { txn: groupTxns[1], sig: roccaSigBytes }

        const enc1 = encodeSignedTransaction(stxn1)
        const enc2 = encodeSignedTransaction(stxn2)


        try {
          const res = await (await AlgorandClient.testNet()).client.algod.sendRawTransaction([enc1, enc2])

          logger.info('[LiquidAuth][Settings] broadcast response', { response: res })
          setLastSignalMessage(`Group transaction successfully broadcast: ${res.txId}`)
        } catch (e) {
          logger.error('[LiquidAuth][Settings] broadcast failed', { error: e as unknown as Record<string, unknown> })
          setLastSignalMessage('Broadcast failed')
        } finally {
          awaitingPawnSignatureRef.current = false
          pendingGroupTxnsRef.current = null
          pendingRoccaSigRef.current = null
          pendingPawnSigRef.current = null
          pendingPawnProcessingRef.current = false
        }
      } catch (err) {
        logger.error('[LiquidAuth][Settings] processPawnSignature error', { error: err as unknown as Record<string, unknown> })
      }
    },
    [hdWalletService]
  )

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
                // ask user to confirm before creating/sending group txns
                logger.info('[LiquidAuth][Settings] asking user to confirm processing peer address', { address: addr })
                setLastSignalMessage(`confirm peer address: ${addr}`)
                setConfirmPawnAddress(addr)
                setConfirmPawnClient(clientRef)
                setConfirmPawnModalVisible(true)
                return
              }
            }

            // NOTE: do not force-await here; we'll buffer signatures if they arrive
            // before group txns are ready (see `pendingPawnSigRef` and
            // `processPawnSignature`).

            // If we are awaiting the pawn's signature, treat non-JSON message as the signature
            if (awaitingPawnSignatureRef.current) {
              ; (async () => {
                try {
                  const raw = (m as string)
                  let parsedObj: any = null
                  try {
                    parsedObj = JSON.parse(raw)
                  } catch (e) {
                    parsedObj = null
                  }
                  logger.info('[LiquidAuth][Settings][DIAG] pawn raw message', { raw })

                  if (!parsedObj) {
                    // Not JSON — unexpected for Pawn; ignore
                    return
                  }

                  if (parsedObj && parsedObj.error) {
                    const errMsg = typeof parsedObj.error === 'string' ? parsedObj.error : parsedObj.error?.message ?? JSON.stringify(parsedObj.error)
                    logger.error('[LiquidAuth][Settings] pawn sign error', { error: errMsg })
                    setLastSignalMessage(`Pawn sign error: ${errMsg}`)
                    awaitingPawnSignatureRef.current = false
                    pendingGroupTxnsRef.current = null
                    pendingRoccaSigRef.current = null
                    return
                  }

                  if (parsedObj && parsedObj.type === 'sign-ack') {
                    return
                  }

                  if (parsedObj && parsedObj.type === 'sign-response' && typeof parsedObj.signature === 'string') {
                    await processPawnSignature(parsedObj.signature)
                    return
                  }
                } catch (err) {
                  logger.error('[LiquidAuth][Settings] error handling pawn signature', { error: err as unknown as Record<string, unknown> })
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
      const groupTxns = await createGroupTxnToSign(pawnAddr, roccaAddr)
      // const groupTxns = [await createSingleTxnToSign(pawnAddr), await createSingleTxnToSign(roccaAddr)]
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

      // If a signature arrived early and was buffered, process it now.
      if (pendingPawnSigRef.current) {
        const buffered = pendingPawnSigRef.current
        pendingPawnSigRef.current = null
        await processPawnSignature(buffered)
      }
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

  const triggerWithPIN = useCallback((action: () => Promise<void>) => {
    pendingActionRef.current = action
    setPinModalVisible(true)
  }, [])

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

  // Handlers for PIN modal
  const onPINAuthComplete = useCallback(
    async (authenticated: any) => {
      setPinModalVisible(false)
      const action = pendingActionRef.current
      pendingActionRef.current = null
      if (action) await action()
    },
    []
  )

  const onPINCancel = useCallback(() => {
    setPinModalVisible(false)
    pendingActionRef.current = null
  }, [])

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
            onPress={() => triggerWithPIN(onRegister)}
            disabled={!!loading || !initDone}
            style={[styles.button, (!!loading || !initDone) ? styles.buttonDisabled : undefined]}
            accessibilityLabel="Register"
            testID="LiquidAuthRegisterButton"
          >
            {(!initDone || loading === 'register') ? (
              <ActivityIndicator color={ColorPalette.grayscale.white} />
            ) : (
              <ThemedText style={{ color: ColorPalette.grayscale.white }}>Register</ThemedText>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => triggerWithPIN(onAuthenticate)}
            disabled={!!loading || !initDone}
            style={[styles.button, (!!loading || !initDone) ? styles.buttonDisabled : undefined]}
            accessibilityLabel="Authenticate"
            testID="LiquidAuthAuthenticateButton"
          >
            {(!initDone || loading === 'authenticate') ? (
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
      {/* PIN verification modal for sensitive actions */}
      <VerifyPINModal
        title={'Enter PIN'}
        visible={pinModalVisible}
        onBackPressed={() => setPinModalVisible(false)}
        onAuthenticationComplete={onPINAuthComplete}
        onCancelAuth={onPINCancel}
        PINVerifyModalUsage={PINEntryUsage.LiquidAuth}
      />

      {/* Confirmation modal shown when a Pawn address arrives; user must confirm before creating/sending group txns */}
      <SafeAreaModal visible={confirmPawnModalVisible} transparent={true}>
        <InfoBox
          notificationType={InfoBoxType.Info}
          title={'Pawn Connected'}
          description={`Pawn peer ${confirmPawnAddress} has connected. Proceed to create and send the grouped transaction?`}
          onCallToActionPressed={async () => {
            setConfirmPawnModalVisible(false)
            const addr = confirmPawnAddress
            const client = confirmPawnClient
            setConfirmPawnAddress(null)
            setConfirmPawnClient(null)
            if (addr && client) await processPawnAddress(addr, client)
          }}
          onCallToActionLabel={'Proceed'}
          secondaryCallToActionTitle={'Cancel'}
          secondaryCallToActionPressed={() => {
            setConfirmPawnModalVisible(false)
            setConfirmPawnAddress(null)
            setConfirmPawnClient(null)
            logger.info('[LiquidAuth][Settings] user cancelled processing pawn address')
          }}
        />
      </SafeAreaModal>
    </SafeAreaView>
  )
}

export default LiquidAuthSettings
