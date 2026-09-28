"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLinkIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { removeInvoice } from "@/app/actions";
import { CATEGORY_LABELS, GET_REASON_LABELS, NOTE_LABELS, formatDate, formatMoney, gmailLink } from "@/lib/labels";
import type { EmailRow, InvoiceRow } from "@/lib/queries";
import { InvoiceSheet } from "./invoice-sheet";
import { EmailSheet } from "./email-sheet";
import { uploadInvoiceFile } from "./upload-dialog";

type Props = {
  tab: string;
  saved: InvoiceRow[];
  toGet: InvoiceRow[];
  failedEmails: EmailRow[];
  ignored: EmailRow[];
  ignoredTotal: number;
};

const TABS = ["invoices", "to-get", "ignored"];

export function DashboardTabs({ tab, saved, toGet, failedEmails, ignored, ignoredTotal }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [emailId, setEmailId] = useState<string | null>(null);

  const selectedInvoice = saved.find((i) => i.id === invoiceId) ?? null;
  const selectedEmail = [...failedEmails, ...ignored].find((e) => e.id === emailId) ?? null;
  const getCount = toGet.length + failedEmails.length;

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.replace(`/?${params}`, { scroll: false });
  };

  return (
    <>
      <Tabs value={TABS.includes(tab) ? tab : "invoices"} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="invoices">
            Invoices <Badge variant="secondary">{saved.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="to-get">
            To get <Badge variant={getCount ? "destructive" : "secondary"}>{getCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ignored">
            Ignored <Badge variant="secondary">{ignoredTotal}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <VatSummary rows={saved} />
              <InvoiceTable rows={saved} onOpen={setInvoiceId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="to-get">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Purchases where the email isn&apos;t the invoice. Get the invoice from the supplier and upload it here; it&apos;s saved into the right
                month in Dropbox. If the real invoice arrives by email later, it&apos;s cleared from here automatically.
              </p>
              <ToGetTable rows={toGet} failed={failedEmails} onOpenEmail={setEmailId} onDone={() => router.refresh()} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ignored">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Emails with no purchase in them (newsletters, promotions, account notices). Open one to add it if it&apos;s actually an invoice.
                {ignoredTotal > ignored.length && ` Showing the latest ${ignored.length} of ${ignoredTotal}; pick a month to narrow it down.`}
              </p>
              <EmailTable rows={ignored} onOpen={setEmailId} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <InvoiceSheet invoice={selectedInvoice} onClose={() => setInvoiceId(null)} />
      <EmailSheet email={selectedEmail} onClose={() => setEmailId(null)} />
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

/** VAT total per currency for the rows shown (usually just £). */
function VatSummary({ rows }: { rows: InvoiceRow[] }) {
  if (!rows.length) return null;
  const totals = new Map<string, number>();
  for (const r of rows) if (r.vatAmount) totals.set(r.currency ?? "GBP", (totals.get(r.currency ?? "GBP") ?? 0) + Number(r.vatAmount));
  return (
    <p className="text-sm text-muted-foreground">
      {rows.length} invoice{rows.length === 1 ? "" : "s"}
      {[...totals].filter(([, total]) => total !== 0).map(([cur, total]) => (
        <span key={cur}>
          {" · "}VAT <span className="font-medium text-foreground tabular-nums">{formatMoney(total.toFixed(2), cur)}</span>
        </span>
      ))}
    </p>
  );
}

function Reasons({ notes, labels }: { notes: string[]; labels: Record<string, { label: string; help: string }> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {notes
        .filter((n) => labels[n])
        .map((n) => (
          <Tooltip key={n}>
            <TooltipTrigger render={<Badge variant="outline" />}>{labels[n].label}</TooltipTrigger>
            <TooltipContent className="max-w-64">{labels[n].help}</TooltipContent>
          </Tooltip>
        ))}
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
    >
      {children} <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}

function InvoiceTable({ rows, onOpen }: { rows: InvoiceRow[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty text="No invoices for this period yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">VAT</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Notes</TableHead>
          <TableHead>File</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
            <TableCell className="whitespace-nowrap">{formatDate(r.invoiceDate)}</TableCell>
            <TableCell className="max-w-64">
              <div className="truncate font-medium">{r.supplierName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {r.invoiceNumber ? `#${r.invoiceNumber}` : r.source === "manual" ? "Uploaded by hand" : r.emailSubject}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(r.netAmount, r.currency)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(r.vatAmount, r.currency)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(r.grossAmount, r.currency)}</TableCell>
            <TableCell>
              <Reasons notes={r.notes} labels={NOTE_LABELS} />
            </TableCell>
            <TableCell>{r.dropboxUrl ? <ExternalLink href={r.dropboxUrl}>Dropbox</ExternalLink> : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ToGetTable({
  rows,
  failed,
  onOpenEmail,
  onDone,
}: {
  rows: InvoiceRow[];
  failed: EmailRow[];
  onOpenEmail: (id: string) => void;
  onDone: () => void;
}) {
  if (!rows.length && !failed.length) return <Empty text="Nothing to get. 🎉" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Why</TableHead>
          <TableHead className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <ToGetRow key={r.id} row={r} onDone={onDone} />
        ))}
        {failed.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap">{formatDate(e.receivedAt)}</TableCell>
            <TableCell className="max-w-64">
              <div className="truncate font-medium">{e.fromName ?? e.fromEmail}</div>
              <div className="truncate text-xs text-muted-foreground">{e.subject}</div>
              <div className="text-xs">
                <ExternalLink href={gmailLink(e.id)}>Open email</ExternalLink>
              </div>
            </TableCell>
            <TableCell className="text-right text-muted-foreground">—</TableCell>
            <TableCell>
              <Badge variant="outline">Couldn&apos;t read</Badge>
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="outline" onClick={() => onOpenEmail(e.id)}>
                Decide
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ToGetRow({ row, onDone }: { row: InvoiceRow; onDone: () => void }) {
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy("upload");
    try {
      await uploadInvoiceFile(file, row.id);
      toast.success(`${row.supplierName} invoice saved to Dropbox`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    const res = await removeInvoice(row.id);
    setBusy(null);
    if (res.ok) toast.success("Removed");
    else toast.error(res.error);
  };

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{formatDate(row.invoiceDate)}</TableCell>
      <TableCell className="max-w-64">
        <div className="truncate font-medium">{row.supplierName}</div>
        <div className="truncate text-xs text-muted-foreground">{row.emailSubject}</div>
        <div className="flex gap-3 text-xs">
          {row.portalUrl && <ExternalLink href={row.portalUrl}>Supplier website</ExternalLink>}
          {row.emailId && <ExternalLink href={gmailLink(row.emailId)}>Open email</ExternalLink>}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(row.grossAmount, row.currency)}</TableCell>
      <TableCell>
        <Reasons notes={row.notes} labels={GET_REASON_LABELS} />
      </TableCell>
      <TableCell className="text-right whitespace-normal">
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={remove}>
            {busy === "remove" && <Loader2Icon className="animate-spin" />}
            Not needed
          </Button>
          <Label className={buttonVariants({ size: "sm" })}>
            {busy === "upload" ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {busy === "upload" ? "Saving…" : "Upload invoice"}
            <input type="file" accept="application/pdf,image/*" className="sr-only" disabled={!!busy} onChange={(e) => upload(e.target.files?.[0])} />
          </Label>
        </div>
      </TableCell>
    </TableRow>
  );
}

function EmailTable({ rows, onOpen }: { rows: EmailRow[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <Empty text="Nothing ignored for this period." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>From</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Why</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e) => (
          <TableRow key={e.id} className="cursor-pointer" onClick={() => onOpen(e.id)}>
            <TableCell className="whitespace-nowrap">{formatDate(e.receivedAt)}</TableCell>
            <TableCell className="max-w-56 truncate font-medium">{e.fromName ?? e.fromEmail}</TableCell>
            <TableCell className="max-w-96 truncate">{e.subject}</TableCell>
            <TableCell>
              <Badge variant="outline">{e.category ? CATEGORY_LABELS[e.category] ?? e.category : "—"}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
