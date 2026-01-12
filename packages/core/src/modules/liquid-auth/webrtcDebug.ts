// Global WebRTC debug hooks for React Native.
// This wraps RTCPeerConnection to log addIceCandidate results
// and connection state transitions, to help diagnose ICE issues
// in the Liquid Auth flows.

export function installWebRtcDebugHooks() {
  try {
    const g: any = (globalThis as any) || (global as any)
    const NativeRTCPeerConnection = g.RTCPeerConnection || g.webkitRTCPeerConnection

    if (!NativeRTCPeerConnection) {
      // Nothing to hook in this environment
      // eslint-disable-next-line no-console
      console.log('[LiquidAuth][DEBUG] WebRTC debug: no global RTCPeerConnection found')
      return
    }

    if (NativeRTCPeerConnection.__liquidDebugInstalled) {
      // Already installed
      return
    }

    // Mark original constructor
    const OriginalRTCPeerConnection = NativeRTCPeerConnection

    // Wrap constructor to attach debug handlers on each instance
    const PatchedRTCPeerConnection = function (this: any, configuration: any) {
      const pc = new OriginalRTCPeerConnection(configuration)

      // Initial state
      // eslint-disable-next-line no-console
      console.log('[LiquidAuth][DEBUG] RTCPeerConnection created', {
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
      })

      // Wrap addIceCandidate to see whether it resolves or throws
      if (pc.addIceCandidate) {
        const originalAddIceCandidate = pc.addIceCandidate.bind(pc)
        pc.addIceCandidate = async (candidate: any) => {
          // eslint-disable-next-line no-console
          console.log('[LiquidAuth][DEBUG] RTCPeerConnection addIceCandidate called', {
            candidate: candidate?.candidate ?? candidate,
          })
          try {
            const result = await originalAddIceCandidate(candidate)
            // eslint-disable-next-line no-console
            console.log('[LiquidAuth][DEBUG] RTCPeerConnection addIceCandidate resolved')
            return result
          } catch (e) {
            // eslint-disable-next-line no-console
            console.log('[LiquidAuth][DEBUG] RTCPeerConnection addIceCandidate error', {
              error: e instanceof Error ? e.message : String(e),
            })
            throw e
          }
        }
      }

      // Track ICE connection state transitions
      const originalIceHandler = pc.oniceconnectionstatechange
      pc.oniceconnectionstatechange = (event: any) => {
        // eslint-disable-next-line no-console
        console.log('[LiquidAuth][DEBUG] RTCPeerConnection iceConnectionState change (global hook)', {
          iceConnectionState: pc.iceConnectionState,
        })
        originalIceHandler?.(event)
      }

      // Track overall peer connection state transitions
      const originalConnHandler = pc.onconnectionstatechange
      pc.onconnectionstatechange = (event: any) => {
        // eslint-disable-next-line no-console
        console.log('[LiquidAuth][DEBUG] RTCPeerConnection connectionState change (global hook)', {
          connectionState: pc.connectionState,
        })
        originalConnHandler?.(event)
      }

      return pc
    }

    // Preserve prototype so instanceof and methods still work
    PatchedRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype
    ;(PatchedRTCPeerConnection as any).__liquidDebugInstalled = true

    g.RTCPeerConnection = PatchedRTCPeerConnection
    if (g.webkitRTCPeerConnection) {
      g.webkitRTCPeerConnection = PatchedRTCPeerConnection
    }

    // eslint-disable-next-line no-console
    console.log('[LiquidAuth][DEBUG] WebRTC debug hooks installed on RTCPeerConnection')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[LiquidAuth][DEBUG] Failed to install WebRTC debug hooks', e)
  }
}
