// Polyfills for the streaming tests under jsdom/node: TextEncoder/Decoder and
// ReadableStream exist in modern Node, but we ensure they are globally present
// so stream.test.ts and the NDJSON reader behave identically across runners.
import { TextEncoder, TextDecoder } from "node:util";

if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as { TextEncoder: unknown }).TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as { TextDecoder: unknown }).TextDecoder = TextDecoder;
}
