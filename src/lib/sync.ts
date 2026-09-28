import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { emails } from "@/db/schema";
import { getConnection } from "./connections";
import { gmailClient, listMessageIds } from "./gmail";
import { processEmail } from "./pipeline";
import { refreshInvoiceLogs } from "./filing";
import { resolveDuplicates } from "./validate";

export const SYNC_START = process.env.SYNC_START_DATE ?? "2026-07-01";
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;

export type SyncStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  failed: number;
  lastError: string | null;
};

const g = globalThis as unknown as { __sync?: SyncStatus };
g.__sync ??= { running: false, startedAt: null, finishedAt: null, total: 0, processed: 0, failed: 0, lastError: null };

export function syncStatus(): SyncStatus {
  return { ...g.__sync! };
}

function gmailDate(d: Date) {
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** Starts a sync in the background. Returns false if one is already running or accounts aren't connected. */
export async function startSync(): Promise<{ started: boolean; reason?: string }> {
  const s = g.__sync!;
  if (s.running) return { started: false, reason: "A sync is already running" };
  if (!(await getConnection("google"))) return { started: false, reason: "Connect Gmail first" };
  if (!(await getConnection("dropbox"))) return { started: false, reason: "Connect Dropbox first" };

  Object.assign(s, { running: true, startedAt: new Date().toISOString(), finishedAt: null, total: 0, processed: 0, failed: 0, lastError: null });
  runSync()
    .catch((e) => (s.lastError = (e as Error).message))
    .finally(() => Object.assign(s, { running: false, finishedAt: new Date().toISOString() }));
  return { started: true };
}

async function runSync() {
  const s = g.__sync!;
  const gmail = await gmailClient();

  // Always list everything since the start date (ids only, ~1 request per 500 emails) so emails
  // that failed before being saved are never skipped; already-handled ones are filtered out below.
  const since = new Date(SYNC_START);
  const ids = await listMessageIds(gmail, `after:${gmailDate(new Date(since.getTime() - 86_400_000))} -in:chats -in:drafts -in:sent`);

  // Skip emails already handled; retry ones that errored (up to MAX_ATTEMPTS) or were interrupted mid-way.
  const done = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const rows = await db
      .select({ id: emails.id, status: emails.status, attempts: emails.attempts })
      .from(emails)
      .where(inArray(emails.id, chunk));
    for (const r of rows) {
      const unfinished = r.status === "error" || r.status === "processing";
      if (!unfinished || r.attempts >= MAX_ATTEMPTS) done.add(r.id);
    }
  }

  const todo = ids.filter((id) => !done.has(id)).reverse(); // oldest first
  s.total = todo.length;

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      try {
        await processEmail(gmail, id);
      } catch (e) {
        s.failed++;
        s.lastError = (e as Error).message;
        console.error(`[sync] ${id}:`, (e as Error).message);
      }
      s.processed++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (s.processed) {
    await resolveDuplicates();
    await refreshInvoiceLogs();
  }
}
