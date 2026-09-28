"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileTextIcon, Loader2Icon, PaperclipIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ignoreEmail, markEmailAsInvoice } from "@/app/actions";
import { CATEGORY_LABELS, formatDate } from "@/lib/labels";
import type { EmailRow } from "@/lib/queries";

type LiveEmail = {
  bodyText: string;
  attachments: { filename: string; mimeType: string; size: number }[];
};

export function EmailSheet({ email, onClose }: { email: EmailRow | null; onClose: () => void }) {
  const [live, setLive] = useState<{ id: string; data?: LiveEmail; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetch(`/api/emails/${email.id}`)
      .then((r) => r.json())
      .then((json) => !cancelled && setLive(json.error ? { id: email.id, error: json.error } : { id: email.id, data: json }))
      .catch((e) => !cancelled && setLive({ id: email.id, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [email]);

  const current = live && email && live.id === email.id ? live : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        onClose();
      } else toast.error(res.error ?? "Something went wrong");
    });

  return (
    <Sheet open={!!email} onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        {email && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap gap-1.5">
                {email.category && <Badge variant="outline">Sorted as: {CATEGORY_LABELS[email.category] ?? email.category}</Badge>}
                {email.confidence != null && <Badge variant="secondary">{Math.round(email.confidence * 100)}% sure</Badge>}
              </div>
              <SheetTitle className="pr-6">{email.subject || "(no subject)"}</SheetTitle>
              <SheetDescription>
                {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail} · {formatDate(email.receivedAt)}
              </SheetDescription>
            </SheetHeader>

            {email.status === "error" && (
              <div className="px-4 pb-3">
                <Alert variant="destructive">
                  <AlertDescription>
                    This email couldn&apos;t be read automatically. If it&apos;s an invoice, click &quot;It&apos;s an invoice&quot; to try again; otherwise ignore it.
                    {email.error && <span className="mt-1 block font-mono text-xs">{email.error}</span>}
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4">
                {!current ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                ) : current.error ? (
                  <p className="text-sm text-destructive">Couldn&apos;t load this email from Gmail: {current.error}</p>
                ) : (
                  <>
                    {!!current.data!.attachments.length && (
                      <div className="mb-4 flex flex-wrap gap-1.5">
                        {current.data!.attachments.map((a, i) => (
                          <Badge key={i} variant="secondary">
                            {a.mimeType === "application/pdf" ? <FileTextIcon /> : <PaperclipIcon />}
                            {a.filename}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <pre className="font-sans text-sm whitespace-pre-wrap break-words">
                      {current.data!.bodyText ? <EmailText text={current.data!.bodyText} /> : "(empty email)"}
                    </pre>
                  </>
                )}
              </div>
            </ScrollArea>
            <Separator />

            <SheetFooter className="flex-row justify-end">
              {email.status !== "ignored" && (
                <Button variant="outline" disabled={pending} onClick={() => run(() => ignoreEmail(email.id), "Moved to Ignored")}>
                  Ignore
                </Button>
              )}
              <Button disabled={pending} onClick={() => run(() => markEmailAsInvoice(email.id), "Added to Invoices")}>
                {pending && <Loader2Icon className="animate-spin" />}
                {pending ? "Reading invoice…" : "It's an invoice"}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Plain-text emails write links out in full ("Track your order [https://…long tracking url…]").
// Show each one as a short clickable link instead; the email text itself is unchanged.
const LINK = /\[(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<>"')\]]+)/g;

function linkLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

function EmailText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const url = m[1] ?? m[2];
    parts.push(text.slice(last, m.index));
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noreferrer" title={url} className="text-blue-600 underline underline-offset-2 dark:text-blue-400">
        {linkLabel(url)} ↗
      </a>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
