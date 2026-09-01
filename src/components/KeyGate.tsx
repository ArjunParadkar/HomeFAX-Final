"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

export default function KeyGate() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "That key is not on this deployment. Check it and try again.");
        return;
      }
      router.push("/records");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="label block" htmlFor={inputId}>
        Access key
      </label>
      <input
        id={inputId}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="one-time-code"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="hfx-…"
        aria-invalid={error != null}
        aria-describedby={error ? errorId : undefined}
        className="input tnum"
      />
      <p id={errorId} role="status" aria-live="polite" className="empty:hidden">
        {error && (
          <span className="text-[0.8125rem] leading-relaxed text-[var(--grade-f)]">{error}</span>
        )}
      </p>
      <button type="submit" disabled={busy || key.length === 0} className="btn btn-primary w-full">
        {busy ? "Checking key…" : "Open HomeFAX"}
      </button>
    </form>
  );
}
