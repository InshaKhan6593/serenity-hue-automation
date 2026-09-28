import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { convert } from "html-to-text";
import type { AttachmentInfo } from "@/db/schema";
import { getConnection } from "./connections";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export async function gmailClient() {
  const conn = await getConnection("google");
  if (!conn) throw new Error("Gmail is not connected");
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: conn.refreshToken });
  return google.gmail({ version: "v1", auth });
}

function isRetryable(e: unknown) {
  const err = e as { code?: number | string; status?: number; message?: string };
  const status = err.code ?? err.status;
  const msg = err.message ?? "";
  const rateLimited = status === 429 || (status === 403 && /rate limit|quota/i.test(msg)) || /quota exceeded/i.test(msg);
  // Brief connection drops (DNS, reset, timeout) are worth retrying too.
  const network = /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(`${err.code ?? ""} ${msg}`);
  return rateLimited || network || (typeof status === "number" && status >= 500);
}

/** Gmail enforces a per-user quota per minute and connections drop; back off and retry instead of failing the email. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryable(e) || attempt >= 6) throw e;
      const wait = Math.min(60_000, 5_000 * 2 ** attempt) + Math.random() * 1_000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** All message ids matching a Gmail search query (handles paging). */
export async function listMessageIds(gmail: gmail_v1.Gmail, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() => gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken }));
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

export type ParsedEmail = {
  id: string;
  threadId: string | null;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: Date;
  bodyText: string;
  bodyHtml: string | null;
  attachments: AttachmentInfo[];
};

function decode(data?: string | null) {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function header(part: gmail_v1.Schema$MessagePart | undefined, name: string) {
  return part?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function parseFrom(value: string | null) {
  if (!value) return { name: null, email: null };
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: value.trim().toLowerCase() };
}

export async function getEmail(gmail: gmail_v1.Gmail, id: string): Promise<ParsedEmail> {
  const { data } = await withRetry(() => gmail.users.messages.get({ userId: "me", id, format: "full" }));
  let plain = "";
  let html = "";
  const attachments: AttachmentInfo[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? "";
    if (part.filename && part.body?.attachmentId) {
      const disposition = header(part, "Content-Disposition") ?? "";
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: mime,
        size: part.body.size ?? 0,
        inline: disposition.toLowerCase().startsWith("inline") || !!header(part, "Content-ID"),
      });
    } else if (mime === "text/plain" && !plain) {
      plain = decode(part.body?.data);
    } else if (mime === "text/html" && !html) {
      html = decode(part.body?.data);
    }
    part.parts?.forEach(walk);
  };
  if (data.payload) walk(data.payload);

  const from = parseFrom(header(data.payload, "From"));
  const bodyText = (html ? convert(html, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }] }) : plain)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    id,
    threadId: data.threadId ?? null,
    fromName: from.name,
    fromEmail: from.email,
    subject: header(data.payload, "Subject"),
    receivedAt: new Date(Number(data.internalDate ?? Date.now())),
    bodyText: bodyText || plain.trim(),
    bodyHtml: html || null,
    attachments,
  };
}

export async function downloadAttachment(gmail: gmail_v1.Gmail, messageId: string, attachmentId: string) {
  const { data } = await withRetry(() => gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId }));
  return Buffer.from(data.data ?? "", "base64url");
}

/**
 * Attachments worth considering as an invoice document: skips small inline
 * images (logos, signature icons) but keeps everything else.
 */
export function candidateAttachments(attachments: AttachmentInfo[]) {
  return attachments.filter((a) => !(a.mimeType.startsWith("image/") && (a.inline || a.size < 20_000)));
}
