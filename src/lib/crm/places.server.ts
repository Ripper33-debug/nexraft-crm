// Minimal Google Places (New) client — no SDK, just fetches against the
// places:searchText endpoint with the API key from the environment. Config-gated
// exactly like Gmail and Stripe: until GOOGLE_PLACES_API_KEY is set in Vercel,
// discovery simply skips the ratings pass and scores on the signals it has.
//
// Why ratings matter for lead gen: OpenStreetMap tells us a business exists, but
// Google reviews tell us it's BUSY. A roofer with 200 reviews and a dead Wix
// site has both the money and the need — that's the lead a rep should call first.

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
// Only the fields we score on — the FieldMask keeps each call in the cheapest
// ("Text Search Pro" / basic) billing tier instead of pulling full place data.
const FIELD_MASK = "places.rating,places.userRatingCount";

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export type PlaceRating = { rating: number | null; reviews: number | null };

async function lookupOne(query: string, timeoutMs: number): Promise<PlaceRating | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      places?: { rating?: number; userRatingCount?: number }[];
    };
    const p = json.places?.[0];
    if (!p) return null;
    return {
      rating: typeof p.rating === "number" ? p.rating : null,
      reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : 0,
    };
  } catch {
    return null; // timeouts / quota errors just skip the signal
  } finally {
    clearTimeout(timer);
  }
}

// Look up ratings for a batch of "Name, City" queries under one hard deadline,
// same race pattern as the website audits: whatever resolves in time is used,
// the rest are simply skipped. Returns a map keyed by the exact query string.
export async function fetchPlaceRatings(
  queries: string[],
  deadlineMs: number,
): Promise<Map<string, PlaceRating>> {
  const out = new Map<string, PlaceRating>();
  if (!isPlacesConfigured() || queries.length === 0) return out;
  const perFetch = Math.max(1500, deadlineMs - 300);
  const work = (async () => {
    const results = await Promise.allSettled(
      queries.map(async (q) => {
        const r = await lookupOne(q, perFetch);
        if (r) out.set(q, r);
      }),
    );
    void results;
  })();
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, deadlineMs))]);
  return out;
}
