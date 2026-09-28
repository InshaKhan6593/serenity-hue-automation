import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeDropboxCode, getDropboxAccountEmail } from "@/lib/dropbox";
import { saveConnection } from "@/lib/connections";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get("oauth_state_dropbox")?.value;
  jar.delete("oauth_state_dropbox");
  const home = new URL("/", req.url);

  if (params.get("error") || !params.get("code") || !expected || params.get("state") !== expected) {
    home.searchParams.set("error", params.get("error_description") ?? "Dropbox connection failed");
    return NextResponse.redirect(home);
  }

  const tokens = await exchangeDropboxCode(params.get("code")!);
  await saveConnection("dropbox", {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    accountEmail: await getDropboxAccountEmail(tokens.access_token),
  });
  home.searchParams.set("connected", "dropbox");
  return NextResponse.redirect(home);
}
