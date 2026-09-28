import "server-only";
import { getConnection, updateAccessToken } from "./connections";
import { MONTH_NAMES } from "./labels";

const API = "https://api.dropboxapi.com";
const CONTENT = "https://content.dropboxapi.com";

export const DROPBOX_ROOT = "/Invoices";

function basicAuth() {
  return "Basic " + Buffer.from(`${process.env.DROPBOX_APP_KEY}:${process.env.DROPBOX_APP_SECRET}`).toString("base64");
}

export function dropboxAuthUrl(state: string) {
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.DROPBOX_APP_KEY!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("redirect_uri", process.env.DROPBOX_REDIRECT_URI!);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeDropboxCode(code: string) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: process.env.DROPBOX_REDIRECT_URI! }),
  });
  if (!res.ok) throw new Error(`Dropbox token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

async function accessToken(): Promise<string> {
  const conn = await getConnection("dropbox");
  if (!conn) throw new Error("Dropbox is not connected");
  if (conn.accessToken && conn.expiresAt && conn.expiresAt.getTime() > Date.now() + 60_000) return conn.accessToken;

  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refreshToken }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await updateAccessToken("dropbox", json.access_token, new Date(Date.now() + json.expires_in * 1000));
  return json.access_token;
}

/** Dropbox-API-Arg must be ASCII: escape anything outside it. */
function apiArg(value: unknown) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

async function rpc<T>(endpoint: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token ?? (await accessToken())}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Dropbox ${endpoint} failed: ${text}`), { body: text });
  return JSON.parse(text) as T;
}

export async function getDropboxAccountEmail(token: string) {
  try {
    const res = await fetch(`${API}/2/users/get_current_account`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

export async function uploadFile(path: string, content: Buffer, mode: "add" | "overwrite" = "add"): Promise<{ path: string }> {
  const res = await fetch(`${CONTENT}/2/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": apiArg({ path, mode, autorename: mode === "add", mute: true }),
    },
    body: new Uint8Array(content),
  });
  if (!res.ok) throw new Error(`Dropbox upload failed: ${await res.text()}`);
  const json = (await res.json()) as { path_display: string };
  return { path: json.path_display };
}

export async function moveFile(fromPath: string, toPath: string): Promise<{ path: string }> {
  const json = await rpc<{ metadata: { path_display: string } }>("files/move_v2", {
    from_path: fromPath,
    to_path: toPath,
    autorename: true,
  });
  return { path: json.metadata.path_display };
}

/** Moves to Dropbox's "Deleted files" (recoverable there for 30 days), not a permanent delete. */
export async function deleteFile(path: string) {
  await rpc("files/delete_v2", { path });
}

export async function sharedLink(path: string): Promise<string> {
  try {
    const json = await rpc<{ url: string }>("sharing/create_shared_link_with_settings", { path });
    return json.url;
  } catch (e) {
    if (!String((e as { body?: string }).body ?? "").includes("shared_link_already_exists")) throw e;
    const json = await rpc<{ links: { url: string }[] }>("sharing/list_shared_links", { path, direct_only: true });
    if (!json.links[0]) throw e;
    return json.links[0].url;
  }
}

/** One folder per month: /Invoices/2026/08 - August */
export function folderFor(invoiceDate: string) {
  const [y, m] = invoiceDate.split("-");
  return `${DROPBOX_ROOT}/${y}/${m} - ${MONTH_NAMES[Number(m) - 1]}`;
}

const SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };

/** 2026-08-17_Kilsby-Williams_94532-1_£480.00.pdf — the same naming she already uses. */
export function invoiceFileName(
  inv: { invoiceDate: string; supplierName: string | null; invoiceNumber: string | null; grossAmount: string | null; currency: string | null },
  ext: string,
) {
  const currency = inv.currency || "GBP";
  const amount = inv.grossAmount == null ? null : `${SYMBOLS[currency] ?? currency + " "}${inv.grossAmount}`;
  const clean = (p: string) =>
    p
      .replace(/[\\/:*?"<>|#]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  const parts = [inv.invoiceDate, inv.supplierName ?? "Unknown", inv.invoiceNumber, amount].filter(Boolean).map((p) => clean(p!));
  return `${parts.join("_")}.${ext}`;
}

/** Every file and folder under a path (handles paging). */
export async function listFolder(path: string, recursive = false) {
  type Entry = { ".tag": "file" | "folder"; path_display: string; path_lower: string };
  let res = await rpc<{ entries: Entry[]; cursor: string; has_more: boolean }>("files/list_folder", { path, recursive });
  const entries = [...res.entries];
  while (res.has_more) {
    res = await rpc("files/list_folder/continue", { cursor: res.cursor });
    entries.push(...res.entries);
  }
  return entries;
}
