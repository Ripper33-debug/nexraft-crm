// Minimal Stripe REST client — no SDK dependency, just form-encoded fetches
// against api.stripe.com with the secret key from the environment. Config-gated
// exactly like Gmail: until STRIPE_SECRET_KEY is set in Vercel, the billing UI
// shows setup instructions and every server fn returns a clean "not configured"
// instead of throwing.

const STRIPE_API = "https://api.stripe.com/v1";

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// Flatten { a: 1, b: { c: "x" }, d: ["y"] } into Stripe's form encoding
// (a=1, b[c]=x, d[0]=y).
function encodeForm(params: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === "object" && v !== null) {
          parts.push(...encodeForm(v as Record<string, unknown>, `${name}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function stripeFetch<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, unknown>,
  method: "POST" | "GET" = params ? "POST" : "GET",
): Promise<StripeResult<T>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "Stripe isn't configured yet." };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const body = method === "POST" && params ? encodeForm(params).join("&") : undefined;
      const url =
        method === "GET" && params
          ? `${STRIPE_API}${path}?${encodeForm(params).join("&")}`
          : `${STRIPE_API}${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body,
        signal: ctrl.signal,
      });
      const json = (await res.json()) as T & { error?: { message?: string } };
      if (!res.ok) {
        return { ok: false, error: json?.error?.message || `Stripe error (${res.status})` };
      }
      return { ok: true, data: json };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, error: "Couldn't reach Stripe — try again." };
  }
}
