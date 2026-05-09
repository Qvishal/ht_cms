import { getToken } from "./auth";
import { encryptPayload, decryptPayload } from "./encryption";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const encryptionKey = process.env.NEXT_PUBLIC_PAYLOAD_ENCRYPTION_KEY;
const shouldEncrypt = process.env.NEXT_PUBLIC_ENCRYPT_PAYLOADS === "true";

async function request(path: string, init?: RequestInit, auth = true) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined)
  };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let body = init?.body;

  // ── Payload Encryption (ALE) ──
  if (shouldEncrypt && encryptionKey && body && typeof body === "string" && headers["Content-Type"] === "application/json") {
    try {
      const parsed = JSON.parse(body);
      const encrypted = await encryptPayload(parsed, encryptionKey);
      body = JSON.stringify({ encrypted });
      headers["X-Payload-Encrypted"] = "true";
    } catch (e) {
      console.error("Payload encryption failed:", e);
    }
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    body,
    headers
  });

  const isEncrypted = res.headers.get("x-payload-encrypted") === "true";
  const text = await res.text();
  let json = text ? JSON.parse(text) : null;

  // ── Payload Decryption (ALE) ──
  if (isEncrypted && encryptionKey && json && json.encrypted) {
    try {
      json = await decryptPayload(json.encrypted, encryptionKey);
    } catch (e) {
      console.error("Payload decryption failed:", e);
    }
  }

  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export function apiGet(path: string) {
  return request(path, { method: "GET", cache: "no-store" }, true);
}

export function apiPost(path: string, body: unknown) {
  return request(path, { method: "POST", body: JSON.stringify(body ?? {}) }, true);
}

export async function apiPostFile(path: string, body: FormData) {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body,
    headers
  });

  const isEncrypted = res.headers.get("x-payload-encrypted") === "true";
  const text = await res.text();
  let json = text ? JSON.parse(text) : null;

  // ── Payload Decryption (ALE) ──
  if (isEncrypted && encryptionKey && json && json.encrypted) {
    try {
      json = await decryptPayload(json.encrypted, encryptionKey);
    } catch (e) {
      console.error("Payload decryption failed:", e);
    }
  }

  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export function apiPut(path: string, body: unknown) {
  return request(path, { method: "PUT", body: JSON.stringify(body ?? {}) }, true);
}

export function apiDelete(path: string) {
  return request(path, { method: "DELETE" }, true);
}

export function apiPublicGet(path: string) {
  return request(path, { method: "GET", cache: "no-store" }, false);
}

