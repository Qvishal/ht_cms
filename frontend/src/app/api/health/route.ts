import { NextResponse } from "next/server";

export async function GET() {
  const backend = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${backend}/health`, { cache: "no-store" });
    const json = await res.json();
    return NextResponse.json(json, { status: res.ok ? 200 : 503 });
  } catch (e) {
    return NextResponse.json({ db: "down", error: (e as Error).message }, { status: 503 });
  }
}
