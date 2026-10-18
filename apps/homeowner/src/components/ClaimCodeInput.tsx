"use client";

import { useState } from "react";

/**
 * The claim code off the card: eight characters, shown as XXXX-XXXX. Typing
 * lowercase or without the dash is fine — the field upper-cases and inserts
 * the dash as you go, and the form still posts a plain string.
 */
export default function ClaimCodeInput({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(format(defaultValue));
  return (
    <input
      id="claim-code"
      name="code"
      value={value}
      onChange={(e) => setValue(format(e.target.value))}
      required
      inputMode="text"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      autoComplete="one-time-code"
      placeholder="XXXX-XXXX"
      maxLength={9}
      pattern="[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}"
      className="input tnum mt-1.5 text-center text-[1.375rem] tracking-[0.2em]"
    />
  );
}

function format(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
