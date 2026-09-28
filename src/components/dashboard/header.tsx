"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, MailIcon, BoxIcon, UnplugIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { disconnect } from "@/app/actions";
import { SyncButton } from "./sync-button";
import { UploadDialog } from "./upload-dialog";

type Conn = { email: string | null } | null;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export function Header({
  connections,
  months,
  month,
}: {
  connections: { google: Conn; dropbox: Conn };
  months: string[];
  month: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setMonth = (value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") params.delete("month");
    else params.set("month", value);
    router.push(`/?${params}`);
  };

  const ready = !!connections.google && !!connections.dropbox;

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Serenity Hue · Invoices</h1>
          <p className="text-sm text-muted-foreground">Invoices from your email, saved to Dropbox by month.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={month ?? "all"} onValueChange={(v) => setMonth(v as string)}>
            <SelectTrigger className="w-44" aria-label="Month">
              <SelectValue>{(v: string) => (v === "all" ? "All months" : monthLabel(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <UploadDialog disabled={!connections.dropbox} />
          <SyncButton disabled={!ready} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionChip name="Gmail" icon={<MailIcon />} conn={connections.google} href="/api/auth/google" provider="google" />
        <ConnectionChip name="Dropbox" icon={<BoxIcon />} conn={connections.dropbox} href="/api/auth/dropbox" provider="dropbox" />
      </div>
    </header>
  );
}

function ConnectionChip({
  name,
  icon,
  conn,
  href,
  provider,
}: {
  name: string;
  icon: React.ReactNode;
  conn: Conn;
  href: string;
  provider: "google" | "dropbox";
}) {
  const [pending, start] = useTransition();
  if (!conn) {
    return (
      <a href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {icon}
        Connect {name}
      </a>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Badge variant="secondary" className="h-7 gap-1.5 px-2.5">
        <CheckCircle2Icon className="text-emerald-600" />
        {name}
        {conn.email && <span className="font-normal text-muted-foreground">{conn.email}</span>}
      </Badge>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Disconnect ${name}`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await disconnect(provider);
                  toast.success(`${name} disconnected`);
                })
              }
            />
          }
        >
          <UnplugIcon />
        </TooltipTrigger>
        <TooltipContent>Disconnect {name}</TooltipContent>
      </Tooltip>
    </div>
  );
}
