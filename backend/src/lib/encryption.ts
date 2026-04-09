import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a JSON object into an encrypted string (Base64)
 * Format: IV (12) + Ciphertext + AuthTag (16)
 */
export function encryptPayload(data: any, keyHex: string): string {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error("Invalid encryption key. Must be a 32-byte hex string (64 characters).");
  }

  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const jsonStr = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(jsonStr, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine IV + EncryptedContent + AuthTag
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

/**
 * Decrypt an encrypted string (Base64) back into a JSON object
 */
export function decryptPayload(encryptedBase64: string, keyHex: string): any {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error("Invalid encryption key. Must be a 32-byte hex string (64 characters).");
  }

  const key = Buffer.from(keyHex, "hex");
  const combined = Buffer.from(encryptedBase64, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted payload.");
  }

  // Extract components
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
