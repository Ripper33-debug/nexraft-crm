// A few small, tasteful surprises. None of these touch data or change behaviour —
// they're purely for a smile when someone stumbles on them. All are SSR-safe and
// respect prefers-reduced-motion via fireConfetti's own guard.

import { useEffect, useRef } from "react";

import { fireConfetti } from "./confetti";
import { toast } from "../../components/crm/toast";

// The classic: ↑ ↑ ↓ ↓ ← → ← → B A. Fires confetti + a cheeky toast.
const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export function useKonamiCode(): void {
  const pos = useRef(0);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore keystrokes while typing into a field.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === KONAMI[pos.current]) {
        pos.current++;
        if (pos.current === KONAMI.length) {
          pos.current = 0;
          fireConfetti();
          toast("🎮 Cheat mode unlocked — now go close something.");
        }
      } else {
        // Allow a wrong key to be the start of a fresh attempt.
        pos.current = key === KONAMI[0] ? 1 : 0;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

// A friendly hello for anyone who opens the browser console. Printed once.
let greeted = false;
export function installConsoleEgg(): void {
  if (greeted || typeof window === "undefined" || typeof console === "undefined") return;
  greeted = true;
  const brand = "color:#2dd4bf;font-weight:bold;font-size:13px";
  const soft = "color:#8a978f";
  // eslint-disable-next-line no-console
  console.log("%cNexraft CRM %c— built with a little too much love. Poke around; there are a couple of surprises. Try the Konami code.", brand, soft);
}

// Secret commands surfaced in the command palette only when typed exactly.
// Each returns a short toast line; some also throw confetti.
export const PALETTE_EGGS: { term: string; label: string; run: () => void }[] = [
  {
    term: "party",
    label: "🎉 Throw a little party",
    run: () => {
      fireConfetti();
      toast("🎉 Party mode. You deserve it.");
    },
  },
  {
    term: "coffee",
    label: "☕ Brew a coffee",
    run: () => toast("☕ Brewing… you've earned it. Back to closing in 5."),
  },
  {
    term: "42",
    label: "🌌 The answer to everything",
    run: () => toast("🌌 42 — the answer to life, the universe, and this quarter's quota."),
  },
  {
    term: "boss",
    label: "😎 Boss mode",
    run: () => toast("😎 Boss mode: engaged. Every call closes today."),
  },
];
