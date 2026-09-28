import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { dropboxAuthUrl } from "@/lib/dropbox";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("oauth_state_dropbox", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(dropboxAuthUrl(state));
}
