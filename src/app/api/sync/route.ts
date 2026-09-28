import { NextResponse } from "next/server";
import { startSync, syncStatus } from "@/lib/sync";

export async function GET() {
  return NextResponse.json(syncStatus());
}

export async function POST() {
  const result = await startSync();
  return NextResponse.json({ ...result, status: syncStatus() }, { status: result.started ? 202 : 409 });
}
