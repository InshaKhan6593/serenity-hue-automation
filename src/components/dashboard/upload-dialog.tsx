"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export async function uploadInvoiceFile(file: File, invoiceId?: number) {
  const form = new FormData();
  form.set("file", file);
  if (invoiceId) form.set("invoiceId", String(invoiceId));
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Upload failed");
  return json as { id: number };
}

export function UploadDialog({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadInvoiceFile(file);
      toast.success("Invoice uploaded", { description: "It's saved to Dropbox and in the Invoices list." });
      setOpen(false);
      setFile(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        <UploadIcon />
        Upload invoice
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload an invoice</DialogTitle>
          <DialogDescription>
            For paper invoices or bills downloaded from a supplier&apos;s website. We&apos;ll read it, save it to Dropbox and add it to the list.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="invoice-file">PDF or photo</Label>
          <Input id="invoice-file" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!file || busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {busy ? "Reading invoice…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
