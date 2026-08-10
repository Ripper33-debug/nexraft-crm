import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { globalSearch, type SearchHit } from "../../lib/crm/data";

const KIND_META: Record<SearchHit["kind"], { label: string; color: string; to: string }> = {
  company: { label: "Company", color: "#38bdf8", to: "/companies" },
  contact: { label: "Contact", color: "#2dd4bf", to: "/contacts" },
  deal: { label: "Deal", color: "#a855f7", to: "/pipeline" },
};

// Persistent header search: debounced live lookup across companies, contacts and
// deals; picking a result routes to the right list page with ?focus=<id> so the
// matching record opens automatically.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Debounced query.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await globalSearch({ data: { q: term } });
        if (mine === seq.current) {
          setHits(res);
          setActive(0);
          setOpen(true);
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Cmd/Ctrl-K to focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    setHits([]);
    navigate({ to: KIND_META[hit.kind].to, search: { focus: hit.id } });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search companies, contacts, deals…"
          className="w-full rounded-lg border border-line bg-surface-2 py-2 pl-9 pr-12 text-sm text-bone placeholder:text-faint focus:border-signal/60 focus:outline-none focus:ring-1 focus:ring-signal/30"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
          ⌘K
        </kbd>
      </div>

      {open ? (
        <div className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-md border border-line bg-surface shadow-sm">
          {loading && hits.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-faint">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-faint">No matches for “{q.trim()}”</div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((hit, i) => {
                const meta = KIND_META[hit.kind];
                return (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(hit)}
                      className={
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors " +
                        (i === active ? "bg-surface-2" : "hover:bg-surface-2/60")
                      }
                    >
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
                        style={{ color: meta.color, backgroundColor: meta.color + "1e" }}
                      >
                        {meta.label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-bone">{hit.title}</span>
                        {hit.subtitle ? (
                          <span className="block truncate text-xs text-faint">{hit.subtitle}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
