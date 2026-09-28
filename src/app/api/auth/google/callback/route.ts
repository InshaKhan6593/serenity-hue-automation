import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { oauthClient } from "@/lib/gmail";
import { saveConnection } from "@/lib/connections";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get("oauth_state_google")?.value;
  jar.delete("oauth_state_google");
  const home = new URL("/", req.url);

  if (params.get("error") || !params.get("code") || !expected || params.get("state") !== expected) {
    home.searchParams.set("error", params.get("error") ?? "Gmail connection failed");
    return NextResponse.redirect(home);
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(params.get("code")!);
  // Google lets people untick individual permissions on the consent screen.
  if (!tokens.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.readonly")) {
    home.searchParams.set("error", "Gmail access wasn't granted. Click Connect Gmail again and tick the box to let the app read your email.");
    return NextResponse.redirect(home);
  }
  if (!tokens.refresh_token) {
    home.searchParams.set("error", "Google did not return a refresh token. Remove the app's access in your Google account and try again.");
    return NextResponse.redirect(home);
  }

  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    email = ticket.getPayload()?.email ?? null;
  }

  await saveConnection("google", {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    accountEmail: email,
  });
  home.searchParams.set("connected", "gmail");
  return NextResponse.redirect(home);
}
