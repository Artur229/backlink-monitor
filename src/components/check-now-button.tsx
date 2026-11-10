"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, Check } from "lucide-react";
import { checkNow } from "@/app/actions";
import { Button } from "@/components/ui/button";

/**
 * Enqueues a manual check, then refreshes the page a few times so the result
 * written by the worker shows up without a manual reload.
 */
export function CheckNowButton({ linkId, size = "sm", compact = false }: { linkId: string; size?: "sm" | "default"; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");
  const [msg, setMsg] = useState("");

  const onClick = () =>
    start(async () => {
      const r = await checkNow(linkId);
      setState(r.ok ? "queued" : "error");
      setMsg(r.message);
      if (r.ok) {
        for (const ms of [3000, 8000, 20000]) setTimeout(() => router.refresh(), ms);
        setTimeout(() => setState("idle"), 20000);
      }
    });

  return (
    <Button
      variant={state === "queued" ? "secondary" : "outline"}
      size={size}
      onClick={onClick}
      disabled={pending || state === "queued"}
      title={state === "error" ? msg : "Перевірити зараз"}
      aria-label={compact ? "Перевірити зараз" : undefined}
      aria-live="polite"
    >
      {state === "queued" ? <Check className="size-3.5" /> : <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />}
      <span className={compact ? "hidden xl:inline" : undefined}>
        {state === "queued" ? "У черзі" : state === "error" ? "Помилка" : "Перевірити зараз"}
      </span>
    </Button>
  );
}
