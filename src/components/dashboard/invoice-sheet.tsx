"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLinkIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { removeInvoice, saveInvoice, type InvoiceFieldsInput } from "@/app/actions";
import { DOC_TYPE_LABELS, NOTE_LABELS, gmailLink } from "@/lib/labels";
import type { InvoiceRow } from "@/lib/queries";
import { uploadInvoiceFile } from "./upload-dialog";

export function InvoiceSheet({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">{invoice && <InvoiceForm key={`${invoice.id}:${invoice.dropboxPath}`} invoice={invoice} onClose={onClose} />}</SheetContent>
    </Sheet>
  );
}

const FIELDS: { key: keyof InvoiceFieldsInput; label: string; type?: string; placeholder?: string; half?: boolean }[] = [
  { key: "supplierName", label: "Supplier" },
  // Empty means "not on the document": placeholders say so rather than showing example values that look real.
  { key: "supplierVatNumber", label: "Supplier VAT number", placeholder: "Not shown", half: true },
  { key: "invoiceNumber", label: "Invoice number", placeholder: "Not shown", half: true },
  { key: "invoiceDate", label: "Invoice date", type: "date", half: true },
  { key: "dueDate", label: "Due date", type: "date", half: true },
  { key: "netAmount", label: "Net (excl. VAT)", placeholder: "Not shown", half: true },
  { key: "vatAmount", label: "VAT", placeholder: "Not shown", half: true },
  { key: "grossAmount", label: "Total (incl. VAT)", placeholder: "Not shown", half: true },
  { key: "currency", label: "Currency", placeholder: "e.g. GBP", half: true },
];

function InvoiceForm({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [fields, setFields] = useState<InvoiceFieldsInput>({
    documentType: invoice.documentType,
    supplierName: invoice.supplierName ?? "",
    supplierVatNumber: invoice.supplierVatNumber,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency ?? "GBP",
    netAmount: invoice.netAmount,
    vatAmount: invoice.vatAmount,
    grossAmount: invoice.grossAmount,
  });

  const busy = pending || uploading;

  const set = (key: keyof InvoiceFieldsInput, value: string | null) => setFields((f) => ({ ...f, [key]: value }));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        onClose();
      } else toast.error(res.error ?? "Something went wrong");
    });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadInvoiceFile(file, invoice.id);
      toast.success("Document replaced");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{invoice.source === "manual" ? "Uploaded by hand" : "From email"}</Badge>
        </div>
        <SheetTitle className="pr-6">{invoice.supplierName || "Invoice"}</SheetTitle>
        <SheetDescription className="truncate">{invoice.emailSubject ?? (invoice.emailFrom ? `From ${invoice.emailFrom}` : "Uploaded by hand")}</SheetDescription>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-4 pb-4">
          {invoice.notes.length > 0 && (
            <Alert>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {invoice.notes.map((n) => (
                    <li key={n}>
                      <span className="font-medium">{NOTE_LABELS[n]?.label ?? n}:</span> {NOTE_LABELS[n]?.help}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {invoice.dropboxUrl && (
              <a href={invoice.dropboxUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLinkIcon /> Open in Dropbox
              </a>
            )}
            {invoice.emailId && (
              <a href={gmailLink(invoice.emailId)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLinkIcon /> Open email
              </a>
            )}
            <Label className={buttonVariants({ variant: "outline", size: "sm" })}>
              {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              {uploading ? "Saving…" : "Replace file"}
              <input type="file" accept="application/pdf,image/*" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
            </Label>
          </div>

          <Separator />

          <div className="grid gap-1.5">
            <Label>Document type</Label>
            <Select value={fields.documentType ?? "invoice"} onValueChange={(v) => set("documentType", v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => DOC_TYPE_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS)
                  .filter(([value]) => value !== "bill_notice")
                  .map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.half ? "grid gap-1.5" : "col-span-2 grid gap-1.5"}>
                <Label htmlFor={f.key}>
                  {f.label}
                </Label>
                <Input
                  id={f.key}
                  type={f.type ?? "text"}
                  inputMode={f.key.endsWith("Amount") ? "decimal" : undefined}
                  placeholder={f.placeholder}
                  value={(fields[f.key] as string | null) ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>

      <Separator />
      <SheetFooter className="flex-row flex-wrap justify-between">
        <Button variant="destructive" disabled={busy} onClick={() => run(() => removeInvoice(invoice.id), "Removed and moved to Ignored")}>
          Not an invoice
        </Button>
        <Button disabled={busy} onClick={() => run(() => saveInvoice(invoice.id, fields), "Saved")}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save
        </Button>
      </SheetFooter>
    </>
  );
}
