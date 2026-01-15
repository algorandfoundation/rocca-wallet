// Worker compatible with react-native-multithreading (and as a fallback via require).
// Exports a single function `derive(mnemonic, iterations, saltInput, length)`

try {
  console.log('[deriveDp256_mt] worker starting — env:', {
    Platform: typeof process !== 'undefined' ? process.platform : 'unknown',
    TextEncoder: typeof TextEncoder !== 'undefined',
  })
} catch (e) {
  // ignore logging errors in constrained worker environments
}

const { DeterministicP256 } = require('@algorandfoundation/dp256')
let TextEncoderLocal = typeof TextEncoder !== 'undefined' ? TextEncoder : null
if (!TextEncoderLocal) {
  try {
    TextEncoderLocal = require('text-encoding').TextEncoder
  } catch (e) {
    TextEncoderLocal = function () {
      this.encode = function (s) {
        const utf8 = []
        for (let i = 0; i < s.length; i++) {
          let charcode = s.charCodeAt(i)
          if (charcode < 0x80) utf8.push(charcode)
          else if (charcode < 0x800) {
            utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f))
          } else if (charcode < 0xd800 || charcode >= 0xe000) {
            utf8.push(
              0xe0 | (charcode >> 12),
              0x80 | ((charcode >> 6) & 0x3f),
              0x80 | (charcode & 0x3f)
            )
          } else {
            i++
            charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff))
            utf8.push(
              0xf0 | (charcode >> 18),
              0x80 | ((charcode >> 12) & 0x3f),
              0x80 | ((charcode >> 6) & 0x3f),
              0x80 | (charcode & 0x3f)
            )
          }
        }
        return new Uint8Array(utf8)
      }
    }
  }
}

async function derive(mnemonic, iterations = 210000, saltInput = 'liquid', length = 512) {
  try {
    console.log('[deriveDp256_mt] derive called', { iterations, length })
    const dp256 = new DeterministicP256()
    const salt = new TextEncoderLocal().encode(saltInput)
    const derived = await dp256.genDerivedMainKeyWithBIP39(mnemonic, salt, iterations, length)
    console.log('[deriveDp256_mt] derive finished — bytes=', derived?.length)
    return Array.from(derived)
  } catch (err) {
    console.error('[deriveDp256_mt] derive failed', err && (err.stack || err.message || err))
    throw err
  }
}

// If running as a worker that receives messages (e.g., spawned via react-native-multithreading),
// listen for incoming messages and respond with a success/error payload compatible with
// the main-thread code (`worker.onmessage` / `worker.postMessage`).
try {
  if (typeof self !== 'undefined' && typeof self.onmessage === 'function') {
    console.log('[deriveDp256_mt] running in worker message-listener mode')
    self.onmessage = async (evt) => {
      const msg = evt && evt.data ? evt.data : evt
      console.log('[deriveDp256_mt] received message', msg && (msg.type || msg))
      try {
        const { mnemonic, iterations, salt, length } = msg
        const arr = await derive(mnemonic, iterations, salt, length)
        try {
          if (typeof self.postMessage === 'function') {
            self.postMessage({ type: 'success', derived: arr })
          }
        } catch (postErr) {
          console.error('[deriveDp256_mt] postMessage failed', postErr)
        }
      } catch (err) {
        console.error('[deriveDp256_mt] worker handler error', err && (err.stack || err.message || err))
        try {
          if (typeof self.postMessage === 'function') {
            self.postMessage({ type: 'error', error: String(err) })
          }
        } catch (postErr) {
          console.error('[deriveDp256_mt] postMessage(error) failed', postErr)
        }
      }
    }
  }
} catch (e) {
  // Ignore environment detection errors
}

module.exports = { derive }
