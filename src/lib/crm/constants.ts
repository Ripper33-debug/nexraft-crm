// Pure constants shared by client and server. No server-only imports here.

export type StageInfo = {
  name: string;
  prob: number; // win probability as a fraction
  kind: "open" | "won" | "lost";
  color: string; // hex for charts / badges
};

// Pipeline tuned for a web-design studio (Nexraft builds websites).
export const STAGES: StageInfo[] = [
  { name: "Lead", prob: 0.1, kind: "open", color: "#94a3b8" },
  { name: "Discovery", prob: 0.25, kind: "open", color: "#38bdf8" },
  { name: "Proposal", prob: 0.5, kind: "open", color: "#6366f1" },
  { name: "Negotiation", prob: 0.7, kind: "open", color: "#a855f7" },
  { name: "In Build", prob: 0.9, kind: "open", color: "#f59e0b" },
  { name: "Launched", prob: 1.0, kind: "won", color: "#22c55e" },
  { name: "Lost", prob: 0.0, kind: "lost", color: "#ef4444" },
];

export const STAGE_NAMES = STAGES.map((s) => s.name);
export const OPEN_STAGES = STAGES.filter((s) => s.kind === "open").map((s) => s.name);

export function stageInfo(name: string): StageInfo {
  return STAGES.find((s) => s.name === name) ?? STAGES[0];
}

export const ACTIVITY_TYPES = ["Call", "Email", "Meeting", "Task", "Note"];
export const LEAD_SOURCES = ["Referral", "Website", "Cold Outreach", "Event", "Social", "Other"];

// Preset, colored company tags (Monday-style labels). Fixed set keeps the whole
// team consistent instead of a sprawl of freeform tags.
export type TagInfo = { name: string; color: string };
export const COMPANY_TAGS: TagInfo[] = [
  { name: "Retainer", color: "#2dd4bf" },
  { name: "One-off", color: "#38bdf8" },
  { name: "Referral", color: "#a855f7" },
  { name: "VIP", color: "#f59e0b" },
  { name: "Warm", color: "#f472b6" },
  { name: "Cold", color: "#64748b" },
  { name: "At risk", color: "#ef4444" },
  { name: "Upsell", color: "#22c55e" },
];

export function tagColor(name: string): string {
  return COMPANY_TAGS.find((t) => t.name === name)?.color ?? "#8a978f";
}

// Tags persist as a comma-separated string; these helpers convert to/from an array.
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
export function serializeTags(tags: string[]): string {
  return tags.filter(Boolean).join(",");
}

// Structured reasons for a lost deal so win/loss analytics can group them.
export const LOST_REASONS = [
  "Price / budget",
  "Went with competitor",
  "Timing / not ready",
  "No response / went dark",
  "Scope mismatch",
  "Lost to in-house",
  "Other",
];

// A deal in an open stage untouched for this many days is "stale".
export const STALE_DAYS = 14;

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function daysBetween(iso: string | null | undefined, to = new Date()): number {
  if (!iso) return 0;
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (isNaN(d.getTime())) return 0;
  return Math.floor((to.getTime() - d.getTime()) / 86400000);
}

// Compact "2m / 4h / 3d / Jun 12" style timestamp for feeds and note threads.
export function relativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (isNaN(d.getTime())) return "";
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
