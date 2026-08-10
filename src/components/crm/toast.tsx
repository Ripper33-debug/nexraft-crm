import { useEffect, useState } from "react";

// Tiny dependency-free toast system. A module-level pub/sub lets any component
// fire `toast("Saved")` without threading a context provider through the tree;
// the single <Toaster/> mounted in the app shell renders the stack.

export type ToastKind = "success" | "error" | "info";
// An optional action button (e.g. "Undo") shown inside the toast.
export type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; message: string; kind: ToastKind; action?: ToastAction };

let counter = 0;
const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

function emit() {
  for (const l of listeners) l(toasts);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, kind: ToastKind = "success", action?: ToastAction) {
  const id = ++counter;
  toasts = [...toasts, { id, message, kind, action }];
  emit();
  // Give people a beat longer to react when there's something to click.
  setTimeout(() => dismiss(id), action ? 6000 : 3200);
}

const KIND: Record<ToastKind, { dot: string; ring: string }> = {
  success: { dot: "#2dd4bf", ring: "border-signal/30" },
  error: { dot: "#ef4444", ring: "border-red-500/30" },
  info: { dot: "#38bdf8", ring: "border-sky-500/30" },
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    setItems(toasts);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {items.map((t) => {
        const k = KIND[t.kind];
        return (
          <div
            key={t.id}
            className={
              "pointer-events-auto flex items-center gap-2.5 rounded-md border bg-surface px-3.5 py-2.5 text-sm text-bone shadow-sm " +
              k.ring
            }
            style={{ animation: "nx-toast-in 180ms ease-out" }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: k.dot }} />
            <span>{t.message}</span>
            {t.action ? (
              <button
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="ml-1.5 shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-xs font-semibold text-signal transition-colors hover:bg-signal-soft"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        );
      })}
      <style>{`@keyframes nx-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
