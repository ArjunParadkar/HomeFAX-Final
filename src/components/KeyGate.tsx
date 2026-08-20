"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function KeyGate() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        setError(body.error ?? "That key did not work.");
        return;
      }
      router.push("/records");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="label block" htmlFor="access-key">
        Access key
      </label>
      <input
        id="access-key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="one-time-code"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="hfx-…"
        className="tnum w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-base outline-none focus:border-[var(--accent)]"
      />
      {error && <p className="text-sm text-[var(--grade-f)]">{error}</p>}
      <button type="submit" disabled={busy || key.length === 0} className="btn btn-primary w-full">
        {busy ? "Checking…" : "Open HomeFAX"}
      </button>
    </form>
  );
}
