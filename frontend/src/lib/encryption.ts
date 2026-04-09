/**
 * AES-256-GCM encryption/decryption using Web Crypto API
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

/**
 * Import a hex string as a CryptoKey
 */
async function importKey(keyHex: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: ALGORITHM },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt data using a hex key
 * Returns Base64 string of IV + Ciphertext + Tag
 */
export async function encryptPayload(data: any, keyHex: string): Promise<string> {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(data));

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encodedData
  );

  // Combine IV + Encrypted Data (Tag is included at the end by Web Crypto)
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Convert to Base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data using a hex key
 */
export async function decryptPayload(encryptedBase64: string, keyHex: string): Promise<any> {
  const key = await importKey(keyHex);
  const combined = new Uint8Array(
    atob(encryptedBase64)
      .split("")
      .map((char) => char.charCodeAt(0))
  );

  const iv = combined.slice(0, IV_LENGTH);
  const encryptedData = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}
