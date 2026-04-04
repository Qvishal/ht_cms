import { getToken } from "./auth";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request(path: string, init?: RequestInit, auth = true) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined)
  };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export function apiGet(path: string) {
  return request(path, { method: "GET" }, true);
}

export function apiPost(path: string, body: unknown) {
  return request(path, { method: "POST", body: JSON.stringify(body ?? {}) }, true);
}

export function apiPut(path: string, body: unknown) {
  return request(path, { method: "PUT", body: JSON.stringify(body ?? {}) }, true);
}

export function apiDelete(path: string) {
  return request(path, { method: "DELETE" }, true);
}

export function apiPublicGet(path: string) {
  return request(path, { method: "GET" }, false);
}

