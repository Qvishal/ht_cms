import { decryptPayload } from "@/lib/encryption";
import { NextResponse } from "next/server";

export async function GET() {
  const backend = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const encryptionKey = process.env.NEXT_PUBLIC_PAYLOAD_ENCRYPTION_KEY;
  
  // ⚠️ SECURITY: Disable SSL verification for development health checks on localhost
  const isLocal = backend.includes("localhost") || backend.includes("127.0.0.1");
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  
  try {
    if (isLocal) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    
    const res = await fetch(`${backend}/health`, { cache: "no-store" });
    let json = await res.json();
    
    // ── Decrypt if necessary ──
    const isEncrypted = res.headers.get("x-payload-encrypted") === "true";
    if (isEncrypted && encryptionKey && json && json.encrypted) {
      json = await decryptPayload(json.encrypted, encryptionKey);
    }
    
    // Restore previous SSL setting
    if (isLocal) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
    
    return NextResponse.json(json, { status: res.ok ? 200 : 503 });
  } catch (e) {
    // Restore previous SSL setting on error
    if (isLocal) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
    console.error("Health check failed:", e);
    return NextResponse.json({ db: "down", error: (e as Error).message }, { status: 503 });
  }
}
