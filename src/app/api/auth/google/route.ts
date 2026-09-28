import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GMAIL_SCOPES, oauthClient } from "@/lib/gmail";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("oauth_state_google", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    scope: GMAIL_SCOPES,
    state,
  });
  return NextResponse.redirect(url);
}
