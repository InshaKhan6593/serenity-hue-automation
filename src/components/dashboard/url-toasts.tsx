"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** Shows OAuth callback results (?connected=gmail / ?error=...) once, then cleans the URL. */
export function UrlToasts() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (connected) toast.success(`${connected === "gmail" ? "Gmail" : "Dropbox"} connected`);
    if (error) toast.error(error);
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("error");
    router.replace(next.size ? `/?${next}` : "/");
  }, [params, router]);

  return null;
}
