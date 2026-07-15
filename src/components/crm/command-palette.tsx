import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { globalSearch, type SearchHit } from "../../lib/crm/data";
import { PALETTE_EGGS } from "../../lib/crm/easter-eggs";

// Module-level opener so any trigger (the header search field, a button) can pop
// the palette without threading props/context through the tree.
let opener: (() => void) | null = null;
export function openCommandPalette() {
  opener?.();
}

// A search-field-shaped button that lives in the header and pops the palette.
export function CommandPaletteTrigger() {
  return (
    <button
      onClick={() => openCommandPalette()}
      className="group flex w-full max-w-md items-center gap-2.5 rounded-lg border border-line bg-surface-2 py-2 pl-3 pr-2.5 text-left text-sm text-faint transition-colors hover:border-signal/40 hover:text-mute"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <span className="flex-1 truncate">Search or jump to…</span>
      <kbd className="hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">⌘K</kbd>
    </button>
  );
}

const KIND_META: Record<SearchHit["kind"], { label: string; color: string; to: string }> = {
  company: { label: "Company", color: "#38bdf8", to: "/companies" },
  contact: { label: "Contact", color: "#2dd4bf", to: "/contacts" },
  deal: { label: "Deal", color: "#a855f7", to: "/pipeline" },
};

type Cmd = { id: string; label: string; hint: string; group: "Create" | "Go to" | "Secret"; run: (nav: ReturnType<typeof useNavigate>) => void };

const NAV_CMDS: { to: string; label: string; admin?: boolean }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/contacts", label: "Contacts" },
  { to: "/companies", label: "Companies" },
  { to: "/activities", label: "Activities" },
  { to: "/reports", label: "Reports" },
  { to: "/calls", label: "Calls" },
  { to: "/team", label: "Team", admin: true },
];

export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Register the global opener + a ⌘K / Ctrl-K toggle.
  useEffect(() => {
    opener = () => {
      setOpen(true);
      setQ("");
      setHits([]);
      setActive(0);
    };
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          const next = !v;
          if (next) {
            setQ("");
            setHits([]);
            setActive(0);
          }
          return next;
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener = null;
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  // Debounced record search.
  useEffect(() => {
    if (!open) return;
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
        if (mine === seq.current) setHits(res);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  const commands: Cmd[] = useMemo(() => {
    const list: Cmd[] = [
      { id: "new-deal", label: "New deal", hint: "Create", group: "Create", run: (nav) => nav({ to: "/pipeline", search: { focus: undefined, new: true } }) },
      { id: "new-company", label: "New company", hint: "Create", group: "Create", run: (nav) => nav({ to: "/companies", search: { focus: undefined, new: true } }) },
      { id: "new-contact", label: "New contact", hint: "Create", group: "Create", run: (nav) => nav({ to: "/contacts", search: { focus: undefined, new: true } }) },
      ...NAV_CMDS.filter((n) => !n.admin || isAdmin).map<Cmd>((n) => ({
        id: `go-${n.to}`,
        label: n.label,
        hint: "Go to",
        group: "Go to",
        run: (nav) => nav({ to: n.to }),
      })),
    ];
    return list;
  }, [isAdmin]);

  const filteredCmds = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return commands;
    const base = commands.filter((c) => c.label.toLowerCase().includes(term) || c.hint.toLowerCase().includes(term));
    // Hidden fun: surface a secret command only when its keyword is typed exactly.
    const eggs = PALETTE_EGGS.filter((e) => e.term === term).map<Cmd>((e) => ({
      id: `egg-${e.term}`,
      label: e.label,
      hint: "Secret",
      group: "Secret",
      run: () => e.run(),
    }));
    return [...base, ...eggs];
  }, [commands, q]);

  // Flat selectable list: commands first, then record hits.
  const items = useMemo(
    () => [
      ...filteredCmds.map((c) => ({ type: "cmd" as const, cmd: c })),
      ...hits.map((h) => ({ type: "hit" as const, hit: h })),
    ],
    [filteredCmds, hits],
  );

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  function close() {
    setOpen(false);
  }

  function run(idx: number) {
    const it = items[idx];
    if (!it) return;
    close();
    if (it.type === "cmd") it.cmd.run(navigate);
    else navigate({ to: KIND_META[it.hit.kind].to, search: { focus: it.hit.id } });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  if (!open) return null;

  let cursor = -1; // running index to align rendered rows with the flat items list

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/70 p-4 backdrop-blur-md duration-150 animate-in fade-in-0 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-gradient-to-b from-surface to-[#0c110e] shadow-[0_24px_70px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/5 duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <svg className="text-faint" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…  (try a name, or 'new deal')"
            className="w-full bg-transparent text-sm text-bone placeholder:text-faint focus:outline-none"
          />
          <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-faint">
              {loading ? "Searching…" : q.trim() ? `No matches for “${q.trim()}”` : "Start typing…"}
            </div>
          ) : (
            <>
              {["Create", "Go to", "Secret"].map((group) => {
                const groupCmds = filteredCmds.filter((c) => c.group === group);
                if (groupCmds.length === 0) return null;
                return (
                  <div key={group} className="mb-1">
                    <div className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">{group}</div>
                    {groupCmds.map((c) => {
                      cursor++;
                      const idx = cursor;
                      return (
                        <button
                          key={c.id}
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => run(idx)}
                          className={
                            "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors " +
                            (idx === active ? "bg-surface-2" : "hover:bg-surface-2/60")
                          }
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-signal-soft text-signal">
                            {c.group === "Create" ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                            )}
                          </span>
                          <span className="flex-1 text-sm text-bone">{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {hits.length > 0 ? (
                <div className="mb-1">
                  <div className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">Results</div>
                  {hits.map((hit) => {
                    cursor++;
                    const idx = cursor;
                    const meta = KIND_META[hit.kind];
                    return (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => run(idx)}
                        className={
                          "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors " +
                          (idx === active ? "bg-surface-2" : "hover:bg-surface-2/60")
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
                          {hit.subtitle ? <span className="block truncate text-xs text-faint">{hit.subtitle}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
