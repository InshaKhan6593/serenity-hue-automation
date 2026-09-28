"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = { running: boolean; total: number; processed: number; failed: number; lastError: string | null; finishedAt: string | null };

export function SyncButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    const res = await fetch("/api/sync", { cache: "no-store" });
    const s = (await res.json()) as Status;
    setStatus(s);
    if (s.running) router.refresh();
    if (wasRunning.current && !s.running) {
      router.refresh();
      if (s.failed) toast.warning(`Sync finished — ${s.failed} email(s) failed`, { description: s.lastError ?? undefined });
      else toast.success(`Sync finished — ${s.processed} email(s) processed`);
    }
    wasRunning.current = s.running;
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial status fetch
    poll();
  }, [poll]);

  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [status?.running, poll]);

  const start = async () => {
    const res = await fetch("/api/sync", { method: "POST" });
    const json = await res.json();
    if (!json.started) toast.error(json.reason ?? "Could not start sync");
    wasRunning.current = true;
    setStatus(json.status);
  };

  const running = status?.running;
  return (
    <Button onClick={start} disabled={disabled || running} title={disabled ? "Connect Gmail and Dropbox first" : undefined}>
      <RefreshCwIcon className={running ? "animate-spin" : undefined} />
      {running ? (status.total ? `Syncing ${status.processed}/${status.total}` : "Finding emails…") : "Sync emails"}
    </Button>
  );
}
