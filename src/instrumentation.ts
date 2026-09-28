export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const minutes = Number(process.env.AUTO_SYNC_MINUTES ?? 15);
  if (!minutes) return;

  const g = globalThis as unknown as { __autoSync?: NodeJS.Timeout };
  if (g.__autoSync) return;

  const { startSync } = await import("./lib/sync");
  // Checks the inbox on a timer; startSync does nothing if an account isn't connected or a sync is already running.
  g.__autoSync = setInterval(() => {
    startSync().catch((e) => console.error("[auto-sync]", e));
  }, minutes * 60_000);
}
