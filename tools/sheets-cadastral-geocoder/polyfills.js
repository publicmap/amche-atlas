// Google Apps Script's V8 runtime version lags behind Chrome/Node, so a few
// newer Array/String/Object methods hyparquet relies on may be missing.
if (!Array.prototype.at) {
  Array.prototype.at = function (n) {
    n = Math.trunc(n) || 0
    if (n < 0) n += this.length
    return n >= 0 && n < this.length ? this[n] : undefined
  }
}
if (!Array.prototype.flat) {
  Array.prototype.flat = function (depth) {
    depth = depth === undefined ? 1 : Math.trunc(depth)
    const flatten = (arr, d) =>
      d > 0
        ? arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? flatten(v, d - 1) : v), [])
        : arr.slice()
    return flatten(this, depth)
  }
}
if (!Object.fromEntries) {
  Object.fromEntries = function (entries) {
    const obj = {}
    for (const [k, v] of entries) obj[k] = v
    return obj
  }
}
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (search, replacement) {
    if (search instanceof RegExp) return this.replace(search, replacement)
    return this.split(search).join(replacement)
  }
}

// Google Apps Script's V8 runtime has no TextDecoder/TextEncoder (they're Web/Node APIs).
// hyparquet needs them at module-load time, so this must be imported before hyparquet.
if (typeof globalThis.TextDecoder === 'undefined') {
  class TextDecoderPolyfill {
    constructor(label) {
      if (label && label.toLowerCase() !== 'utf-8' && label.toLowerCase() !== 'utf8') {
        throw new Error(`TextDecoder polyfill only supports utf-8, got ${label}`)
      }
    }

    decode(input) {
      if (input === undefined) return ''
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
      let out = ''
      let i = 0
      while (i < bytes.length) {
        const b0 = bytes[i]
        if (b0 < 0x80) {
          out += String.fromCharCode(b0)
          i += 1
        } else if ((b0 & 0xe0) === 0xc0) {
          const b1 = bytes[i + 1] ?? 0
          out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f))
          i += 2
        } else if ((b0 & 0xf0) === 0xe0) {
          const b1 = bytes[i + 1] ?? 0
          const b2 = bytes[i + 2] ?? 0
          out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f))
          i += 3
        } else if ((b0 & 0xf8) === 0xf0) {
          const b1 = bytes[i + 1] ?? 0
          const b2 = bytes[i + 2] ?? 0
          const b3 = bytes[i + 3] ?? 0
          let cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
          cp -= 0x10000
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
          i += 4
        } else {
          out += String.fromCharCode(b0)
          i += 1
        }
      }
      return out
    }
  }
  globalThis.TextDecoder = TextDecoderPolyfill
}

if (typeof globalThis.TextEncoder === 'undefined') {
  class TextEncoderPolyfill {
    encode(str) {
      const bytes = []
      for (let i = 0; i < str.length; i++) {
        let cp = str.codePointAt(i)
        if (cp > 0xffff) i++
        if (cp < 0x80) {
          bytes.push(cp)
        } else if (cp < 0x800) {
          bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
        } else if (cp < 0x10000) {
          bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        } else {
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f)
          )
        }
      }
      return new Uint8Array(bytes)
    }
  }
  globalThis.TextEncoder = TextEncoderPolyfill
}
