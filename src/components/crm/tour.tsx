import { useEffect, useState } from "react";

// A friendly one-time welcome tour. It opens automatically the very first time
// someone lands in the app (tracked in localStorage), and can be replayed on
// demand from the Help page via startTour(). Kept dependency-free and robust:
// it's a centered step-through card rather than fragile element-anchored
// coach-marks, so it never breaks when the layout changes.

// v2: expanded to cover the real daily routine (My Day → call → log → email →
// pipeline). Bumping the key shows the refreshed tour once to existing reps too.
const SEEN_KEY = "nexraft_tour_seen_v2";
const listeners = new Set<() => void>();

// Ask the tour to open (used by the "Replay the tour" button on Help).
export function startTour() {
  for (const l of listeners) l();
}

type Step = { emoji: string; title: string; body: string };

const STEPS: Step[] = [
  {
    emoji: "👋",
    title: "Welcome to your CRM",
    body: "This is where you track the businesses you're talking to, the people at them, and the deals you're working to win. Here's a quick tour of a typical day — you can replay it any time from the Help page.",
  },
  {
    emoji: "🌅",
    title: "Start every day on My Day",
    body: "You'll land on My Day when you sign in. It's your game plan: who to call first, which follow-ups are due, and any proposals that just got opened. Work top to bottom and you're covered.",
  },
  {
    emoji: "📞",
    title: "The Calls queue tees up who to call",
    body: "New companies land in the Calls queue automatically. Open one and hit the big 📞 Call button — you get the phone number, a suggested script, and the AI research on the business, all on one screen.",
  },
  {
    emoji: "✅",
    title: "Log the call with one tap",
    body: "When you hang up, tap the outcome — spoke with them, voicemail, no answer. That's it. The CRM logs it and creates your follow-up task automatically, so nothing slips.",
  },
  {
    emoji: "✉️",
    title: "Missed them? Email them right away",
    body: "If you get voicemail or no answer, an “Email them now” button appears with a pre-written message ready to send — it even uses the AI draft written just for that business. One click, and you've still made contact.",
  },
  {
    emoji: "📬",
    title: "Outreach keeps follow-ups moving",
    body: "The Outreach page collects everyone who didn't pick up and has an email on file. Review the pre-written nudges and, if Gmail is connected, hit “Approve & send all” to clear the whole list in one go.",
  },
  {
    emoji: "🗂️",
    title: "The pipeline reads left to right",
    body: "The board goes To Call → Lost → Proposal → Negotiation → In Build → Launched. Drag a card to move it. The 🔎 on a card means AI research is ready, and 📨 copies the proposal link right from the board.",
  },
  {
    emoji: "🤝",
    title: "Everything has one owner",
    body: "Each company, contact, and deal belongs to one person, so nobody steps on each other's toes. You can hand a record off or share it, and the owner gets a heads-up via the bell up top.",
  },
  {
    emoji: "💡",
    title: "You can't break anything",
    body: "Hover the little “?” next to any number for a plain-English explanation. Archived or moved something by mistake? Hit Undo in the corner. And the full guide is always in Help.",
  },
];

export function WelcomeTour({ name }: { name?: string }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    // First run: auto-open if they've never seen it.
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    if (!seen) setOpen(true);

    // Let the Help page re-open it on demand.
    const openFn = () => {
      setI(0);
      setOpen(true);
    };
    listeners.add(openFn);
    return () => {
      listeners.delete(openFn);
    };
  }, []);

  function finish() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — fine, it'll just show again */
    }
  }

  if (!open) return null;

  const step = STEPS[i];
  const first = i === 0;
  const last = i === STEPS.length - 1;
  const firstName = (name || "").split(" ")[0];
  const title = first && firstName ? `Welcome, ${firstName}` : step.title;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={finish}
        style={{ animation: "nx-tour-fade 150ms ease-out" }}
      />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/50"
        style={{ animation: "nx-tour-pop 180ms ease-out" }}
      >
        {/* Skip */}
        <button
          onClick={finish}
          className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-xs font-medium text-faint transition-colors hover:text-mute"
        >
          Skip
        </button>

        <div className="bg-gradient-to-br from-signal-soft/50 via-surface to-surface px-6 pb-5 pt-8">
          <div className="text-4xl leading-none">{step.emoji}</div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-bone">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-mute">{step.body}</p>
        </div>

        <div className="flex items-center justify-between border-t border-line px-6 py-4">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, idx) => (
              <span
                key={idx}
                className={
                  "h-1.5 rounded-full transition-all duration-200 " +
                  (idx === i ? "w-5 bg-signal" : "w-1.5 bg-line-strong")
                }
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!first ? (
              <button
                onClick={() => setI((n) => Math.max(0, n - 1))}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-mute transition-colors hover:border-line-strong hover:text-bone"
              >
                Back
              </button>
            ) : null}
            {last ? (
              <button
                onClick={finish}
                className="rounded-lg bg-signal px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-signal-strong"
              >
                Get started
              </button>
            ) : (
              <button
                onClick={() => setI((n) => Math.min(STEPS.length - 1, n + 1))}
                className="rounded-lg bg-signal px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-signal-strong"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes nx-tour-fade{from{opacity:0}to{opacity:1}}@keyframes nx-tour-pop{from{opacity:0;transform:scale(0.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
    </div>
  );
}
