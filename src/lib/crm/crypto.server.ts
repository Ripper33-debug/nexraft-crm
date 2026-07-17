// Symmetric encryption for secrets we must store at rest — specifically each
// rep's Gmail OAuth refresh token. We never want those sitting in the database
// in plaintext, so they're sealed with AES-256-GCM using a key derived from the
// GMAIL_TOKEN_SECRET env var. Uses Web Crypto (crypto.subtle), which is the same
// primitive auth.server.ts already relies on, so it works in the Vercel runtime.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Fail closed: if the secret isn't configured we refuse to store tokens rather
// than silently falling back to plaintext.
function secret(): string {
  const s = process.env.GMAIL_TOKEN_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "GMAIL_TOKEN_SECRET is missing or too short — set a 32+ char random secret to enable email sending.",
    );
  }
  return s;
}

let _keyPromise: Promise<CryptoKey> | null = null;
function aesKey(): Promise<CryptoKey> {
  if (_keyPromise) return _keyPromise;
  _keyPromise = (async () => {
    // Derive a fixed 256-bit key from the secret via SHA-256.
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret()));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  })();
  return _keyPromise;
}

// Returns "<ivB64>:<cipherB64>". A fresh random IV per call.
export async function seal(plaintext: string): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(plaintext),
  );
  return `${toB64(iv)}:${toB64(new Uint8Array(cipher))}`;
}

export async function open(sealed: string): Promise<string> {
  const [ivB64, cipherB64] = sealed.split(":");
  if (!ivB64 || !cipherB64) throw new Error("Malformed sealed secret.");
  const key = await aesKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) as BufferSource },
    key,
    fromB64(cipherB64) as BufferSource,
  );
  return decoder.decode(plain);
}
