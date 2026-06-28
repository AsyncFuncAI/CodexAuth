/**
 * Tiny MD5 implementation. Gravatar requires MD5 of the lowercased+trimmed email
 * — NOT SHA-256 (the live site's SHA-256 never resolves to any avatar). WebCrypto
 * SubtleCrypto does not implement MD5, so we need this self-contained version.
 *
 * Public-domain-style compact MD5 (RFC 1321). Operates on the UTF-8 bytes of the
 * input string and returns a lowercase hex digest.
 */
export function md5(input: string): string {
  const bytes = utf8Bytes(input);
  const digest = md5bytes(bytes);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function utf8Bytes(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  // Minimal fallback
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function md5bytes(msg: Uint8Array): Uint8Array {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const origLenBits = msg.length * 8;
  // pad: append 0x80, then zeros, until length ≡ 56 (mod 64); then 64-bit length
  const withOne = msg.length + 1;
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const lenLo = origLenBits >>> 0;
  const lenHi = Math.floor(origLenBits / 4294967296) >>> 0;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, lenLo, true);
  dv.setUint32(padded.length - 4, lenHi, true);

  const rotl = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) >>> 0;

  for (let off = 0; off < padded.length; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i]! + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, s[i]!)) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return out;
}
