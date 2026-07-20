import { createFileRoute } from "@tanstack/react-router";

import { getSharedTeaser, type SharedTeaser } from "../lib/crm/data";
import { LogoMark } from "../components/crm/brand";

// PUBLIC sneak-peek page for PROSPECTS (no login): an unguessable /peek/<token>
// link that renders a designed "what your new homepage could look like" mock,
// art-directed per industry and personalized from the research dossier (real
// services, real rating, real city, real founding year). The whole point is
// that it looks like a $10k custom site, not a template — a prospect seeing
// their OWN business looking this good is the strongest close we have.

export const Route = createFileRoute("/peek/$token")({
  loader: async ({ params }) => {
    const company = await getSharedTeaser({ data: { token: params.token } }).catch(() => null);
    return { company };
  },
  component: PeekPage,
});

// ---- Dossier parsing --------------------------------------------------------

type Dossier = {
  services: string[];
  established: string | null;
  serviceArea: string | null;
  rating: number | null;
  reviews: number | null;
  summary: string | null;
};

function parseDossier(raw: string | null): Dossier {
  const empty: Dossier = { services: [], established: null, serviceArea: null, rating: null, reviews: null, summary: null };
  try {
    const d = JSON.parse(raw || "{}") as Record<string, unknown>;
    return {
      services: Array.isArray(d.services) ? d.services.filter((s): s is string => typeof s === "string").slice(0, 6) : [],
      established: typeof d.established === "string" ? d.established : null,
      serviceArea: typeof d.serviceArea === "string" ? d.serviceArea : null,
      rating: typeof d.rating === "number" ? d.rating : null,
      reviews: typeof d.reviews === "number" ? d.reviews : null,
      summary: typeof d.summary === "string" ? d.summary : null,
    };
  } catch {
    return empty;
  }
}

// ---- Industry art direction -------------------------------------------------
// Each theme is a full visual identity: palette, hero vocabulary, fallback
// services, and section flavor. Matched against industry + dossier services so
// a plumber's peek and a salon's peek feel like different design studios did them.

type Theme = {
  id: string;
  // colors
  bg: string; // page background
  panel: string; // card background
  ink: string; // main text on bg
  sub: string; // secondary text
  accent: string; // brand accent
  accentInk: string; // text on accent
  heroGrad: string; // hero background layers
  serif: boolean; // serif display for upscale trades
  // copy
  tagline: string;
  headline: (name: string, place: string | null) => string;
  subcopy: string;
  cta: string;
  services: string[];
  proofWord: string; // "homeowners" / "diners" / "clients"
};

const THEMES: { match: RegExp; theme: Theme }[] = [
  {
    match: /plumb|hvac|heating|cooling|air condition|electric|septic|drain/i,
    theme: {
      id: "trades",
      bg: "#0b1220", panel: "#111a2c", ink: "#f4f6fb", sub: "#9fb0c9",
      accent: "#ffb648", accentInk: "#1a1206",
      heroGrad: "radial-gradient(70% 90% at 85% 10%, rgba(255,182,72,0.16), transparent 60%), linear-gradient(180deg, #0b1220 0%, #0e1626 100%)",
      serif: false,
      tagline: "Licensed · Insured · On time",
      headline: (n, p) => `${p ?? "Your area"}'s straight-shooting ${n.toLowerCase().includes("plumb") ? "plumbers" : "home-service pros"}.`,
      subcopy: "Up-front pricing, clean work, and a real person answering the phone. That's the whole pitch.",
      cta: "Get a fast quote",
      services: ["Emergency repairs", "Installations", "Maintenance plans", "Free estimates"],
      proofWord: "homeowners",
    },
  },
  {
    match: /landscap|lawn|garden|tree|irrigation|outdoor/i,
    theme: {
      id: "landscape",
      bg: "#0c1410", panel: "#121d16", ink: "#f2f6ee", sub: "#9db4a3",
      accent: "#8fd14f", accentInk: "#0e1a08",
      heroGrad: "radial-gradient(70% 90% at 80% 0%, rgba(143,209,79,0.14), transparent 60%), linear-gradient(180deg, #0c1410 0%, #101a13 100%)",
      serif: false,
      tagline: "Design · Build · Maintain",
      headline: (n, p) => `Outdoor spaces ${p ? `${p} ` : ""}neighbors stop to look at.`,
      subcopy: "From first sketch to final planting, one crew owns your project end to end.",
      cta: "Book a design visit",
      services: ["Landscape design", "Hardscapes & patios", "Lawn care programs", "Seasonal cleanups"],
      proofWord: "homeowners",
    },
  },
  {
    match: /restaurant|cafe|coffee|bakery|pizza|grill|bar|catering|food/i,
    theme: {
      id: "food",
      bg: "#160f0b", panel: "#1f1610", ink: "#f7efe4", sub: "#c2ab90",
      accent: "#e8563f", accentInk: "#fff5ec",
      heroGrad: "radial-gradient(80% 100% at 50% 0%, rgba(232,86,63,0.18), transparent 65%), linear-gradient(180deg, #160f0b 0%, #1a120c 100%)",
      serif: true,
      tagline: "Est. locally · Made fresh daily",
      headline: (n, p) => `The table ${p ? `${p} ` : ""}keeps coming back to.`,
      subcopy: "Menus, hours, and online ordering — everything your guests need, one tap away.",
      cta: "See the menu",
      services: ["Full menu online", "Online ordering", "Reservations", "Private events"],
      proofWord: "regulars",
    },
  },
  {
    match: /salon|spa|beauty|barber|nail|lash|hair|aesthet/i,
    theme: {
      id: "beauty",
      bg: "#151013", panel: "#1d161b", ink: "#f8f2f4", sub: "#bfa9b4",
      accent: "#e9a0b4", accentInk: "#2a0f18",
      heroGrad: "radial-gradient(70% 90% at 75% 0%, rgba(233,160,180,0.16), transparent 60%), linear-gradient(180deg, #151013 0%, #191218 100%)",
      serif: true,
      tagline: "By appointment · Walk-ins welcome",
      headline: (n, p) => `Look like you booked the best ${p ? `in ${p}` : "in town"}.`,
      subcopy: "Browse the work, meet the team, and book your chair online in under a minute.",
      cta: "Book online",
      services: ["Signature services", "Online booking", "Meet the stylists", "Gift cards"],
      proofWord: "clients",
    },
  },
  {
    match: /auto|mechanic|tire|body shop|detail|car|towing/i,
    theme: {
      id: "auto",
      bg: "#101114", panel: "#17181d", ink: "#f3f4f6", sub: "#9aa0ad",
      accent: "#ff3b30", accentInk: "#ffffff",
      heroGrad: "radial-gradient(70% 90% at 85% 10%, rgba(255,59,48,0.14), transparent 60%), linear-gradient(180deg, #101114 0%, #131418 100%)",
      serif: false,
      tagline: "Honest diagnostics · Fair prices",
      headline: (n, p) => `The shop ${p ? `${p} ` : ""}drivers actually trust.`,
      subcopy: "Straight answers, photos of the problem, and your car back when we said.",
      cta: "Get an estimate",
      services: ["Diagnostics", "Repairs & maintenance", "Tires & brakes", "Fleet service"],
      proofWord: "drivers",
    },
  },
  {
    match: /roof|construction|contractor|remodel|builder|concrete|paint|floor|renovat/i,
    theme: {
      id: "build",
      bg: "#121110", panel: "#1a1815", ink: "#f6f3ee", sub: "#aca396",
      accent: "#f5c518", accentInk: "#1a1403",
      heroGrad: "radial-gradient(70% 90% at 80% 0%, rgba(245,197,24,0.13), transparent 60%), linear-gradient(180deg, #121110 0%, #161411 100%)",
      serif: false,
      tagline: "Licensed · Bonded · Insured",
      headline: (n, p) => `Built right the first time${p ? `, ${p}` : ""}.`,
      subcopy: "Clear bids, clean job sites, and a crew that shows up when they say they will.",
      cta: "Request a bid",
      services: ["Free estimates", "Project gallery", "Financing options", "Warranty-backed work"],
      proofWord: "homeowners",
    },
  },
  {
    match: /law|legal|attorney|account|cpa|tax|financ|insur|consult|real estate|realt/i,
    theme: {
      id: "professional",
      bg: "#0d1117", panel: "#131a23", ink: "#f2f5f9", sub: "#98a6b8",
      accent: "#c9a24b", accentInk: "#141005",
      heroGrad: "radial-gradient(70% 90% at 75% 0%, rgba(201,162,75,0.13), transparent 60%), linear-gradient(180deg, #0d1117 0%, #10161e 100%)",
      serif: true,
      tagline: "Trusted counsel, close to home",
      headline: (n, p) => `Advice you'd send your family to${p ? ` — right here in ${p}` : ""}.`,
      subcopy: "Plain-English guidance, transparent fees, and responses the same business day.",
      cta: "Schedule a consultation",
      services: ["Free consultation", "Practice areas", "Client portal", "Meet the team"],
      proofWord: "clients",
    },
  },
  {
    match: /gym|fitness|yoga|martial|dance|training|crossfit|pilates/i,
    theme: {
      id: "fitness",
      bg: "#0e0f0d", panel: "#151713", ink: "#f4f6f0", sub: "#a4ad9c",
      accent: "#c6f542", accentInk: "#141a02",
      heroGrad: "radial-gradient(70% 90% at 80% 0%, rgba(198,245,66,0.12), transparent 60%), linear-gradient(180deg, #0e0f0d 0%, #121410 100%)",
      serif: false,
      tagline: "First class free",
      headline: (n, p) => `Stronger starts here${p ? `, ${p}` : ""}.`,
      subcopy: "Real coaching, a real community, and a schedule that fits your life.",
      cta: "Claim your free class",
      services: ["Class schedule", "Personal training", "Membership plans", "Free trial class"],
      proofWord: "members",
    },
  },
  {
    match: /dental|dentist|medical|clinic|chiro|vet|therap|health|optom/i,
    theme: {
      id: "care",
      bg: "#0c1416", panel: "#121c1f", ink: "#f1f7f8", sub: "#93aab0",
      accent: "#4fd1c5", accentInk: "#062320",
      heroGrad: "radial-gradient(70% 90% at 80% 0%, rgba(79,209,197,0.13), transparent 60%), linear-gradient(180deg, #0c1416 0%, #101a1d 100%)",
      serif: false,
      tagline: "Now accepting new patients",
      headline: (n, p) => `Care that feels like ${p ? `${p}'s` : "your"} family doctor should.`,
      subcopy: "Easy online scheduling, honest pricing, and a team that remembers your name.",
      cta: "Book an appointment",
      services: ["Online scheduling", "New patient specials", "Insurance accepted", "Meet the providers"],
      proofWord: "patients",
    },
  },
];

const DEFAULT_THEME: Theme = {
  id: "default",
  bg: "#0f0e0c", panel: "#171512", ink: "#f6f3ec", sub: "#aba295", accent: "#ff6a2b", accentInk: "#1c0a02",
  heroGrad: "radial-gradient(70% 90% at 80% 0%, rgba(255,106,43,0.14), transparent 60%), linear-gradient(180deg, #0f0e0c 0%, #131210 100%)",
  serif: false,
  tagline: "Local · Independent · Trusted",
  headline: (n, p) => `${p ?? "Your neighborhood"}'s go-to, now with a site to match.`,
  subcopy: "Everything your customers need to choose you — services, proof, and one obvious way to get in touch.",
  cta: "Get in touch",
  services: ["What we do", "Why choose us", "Recent work", "Contact"],
  proofWord: "customers",
};

function pickTheme(company: SharedTeaser, dossier: Dossier): Theme {
  const hay = `${company.industry ?? ""} ${company.name} ${dossier.services.join(" ")}`;
  for (const { match, theme } of THEMES) if (match.test(hay)) return theme;
  return DEFAULT_THEME;
}

// Short place name for headlines: "Boise" from "Boise, ID".
function placeName(company: SharedTeaser, dossier: Dossier): string | null {
  const raw = dossier.serviceArea || company.city;
  if (!raw) return null;
  return raw.split(",")[0].trim() || null;
}

// ---- Page -------------------------------------------------------------------

function PeekPage() {
  const { company } = Route.useLoaderData() as { company: SharedTeaser | null };

  if (!company) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-4">
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 text-center shadow-xl">
          <div className="mb-4 flex items-center justify-center gap-2.5">
            <LogoMark size={34} radius={9} />
            <span className="text-lg font-semibold tracking-tight text-bone">
              Nexraft<span className="text-signal">.</span>
            </span>
          </div>
          <h1 className="text-xl font-semibold text-bone">This preview isn&apos;t active</h1>
          <p className="mt-2 text-sm text-mute">
            Reach out to your Nexraft contact and we&apos;ll send you a fresh link right away.
          </p>
        </div>
      </div>
    );
  }

  const dossier = parseDossier(company.research);
  const t = pickTheme(company, dossier);
  const place = placeName(company, dossier);
  const services = dossier.services.length >= 3 ? dossier.services.slice(0, 6) : t.services;
  const year = dossier.established;
  const rating = dossier.rating;
  const display = t.serif
    ? "Georgia, 'Times New Roman', serif"
    : "'Bricolage Grotesque', 'Geist', system-ui, sans-serif";

  const stats: { big: string; small: string }[] = [];
  if (year) stats.push({ big: `Since ${year}`, small: "locally owned & operated" });
  if (rating) stats.push({ big: `${rating.toFixed(1)} ★`, small: `${dossier.reviews ? `${dossier.reviews} reviews` : "rated by real " + t.proofWord}` });
  if (place) stats.push({ big: place, small: "and surrounding areas" });
  if (stats.length < 3) stats.push({ big: "Same-day", small: "replies, every time" });

  return (
    <div className="min-h-dvh" style={{ background: "#08080b" }}>
      {/* Nexraft framing bar — this is a preview, and we say so proudly */}
      <div className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <LogoMark size={22} radius={6} />
            <span className="truncate text-xs text-mute">
              <span className="font-semibold text-bone">Sneak peek</span> — what {company.name}&apos;s new
              homepage could look like
            </span>
          </div>
          <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-faint sm:block">
            Concept by Nexraft
          </span>
        </div>
      </div>

      {/* ======= THE MOCK SITE ======= */}
      <div className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-8">
        <div
          className="overflow-hidden rounded-2xl border shadow-2xl shadow-black/60"
          style={{ background: t.bg, borderColor: "rgba(255,255,255,0.08)", color: t.ink }}
        >
          {/* Mock nav */}
          <nav className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <span className="truncate text-base font-bold tracking-tight sm:text-lg" style={{ fontFamily: display }}>
              {company.name}
            </span>
            <div className="hidden items-center gap-6 text-[13px] md:flex" style={{ color: t.sub }}>
              <span>Services</span>
              <span>About</span>
              <span>Reviews</span>
              <span>Contact</span>
            </div>
            <span
              className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-bold sm:px-4 sm:text-[13px]"
              style={{ background: t.accent, color: t.accentInk }}
            >
              {company.phone ? company.phone : t.cta}
            </span>
          </nav>

          {/* Hero */}
          <header className="relative px-5 pb-12 pt-12 sm:px-8 sm:pb-16 sm:pt-16" style={{ background: t.heroGrad }}>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] sm:text-[11px]" style={{ color: t.accent }}>
              {t.tagline}
            </p>
            <h1
              className="mt-3 max-w-2xl text-4xl font-bold leading-[1.03] tracking-tight sm:text-6xl"
              style={{ fontFamily: display }}
            >
              {t.headline(company.name, place)}
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed" style={{ color: t.sub }}>
              {t.subcopy}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <span className="rounded-lg px-5 py-2.5 text-sm font-bold" style={{ background: t.accent, color: t.accentInk }}>
                {t.cta}
              </span>
              <span
                className="rounded-lg px-5 py-2.5 text-sm font-semibold"
                style={{ border: "1px solid rgba(255,255,255,0.18)", color: t.ink }}
              >
                {company.phone ? `Call ${company.phone}` : "See our work"}
              </span>
            </div>

            {/* Trust strip */}
            <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
              {stats.slice(0, 3).map((s) => (
                <div key={s.big} className="rounded-xl px-3 py-3 sm:px-4" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="text-sm font-bold tracking-tight sm:text-lg" style={{ fontFamily: display }}>{s.big}</p>
                  <p className="mt-0.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: t.sub }}>{s.small}</p>
                </div>
              ))}
            </div>
          </header>

          {/* Services */}
          <section className="px-5 py-12 sm:px-8" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-end justify-between gap-4">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ fontFamily: display }}>
                What we do
              </h2>
              <span className="hidden text-[12px] sm:block" style={{ color: t.sub }}>
                {place ? `Serving ${place} and beyond` : "Full service, start to finish"}
              </span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s, i) => (
                <div key={s} className="group rounded-xl p-4 sm:p-5" style={{ background: t.panel, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="font-mono text-[11px] font-bold" style={{ color: t.accent }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-1.5 text-[15px] font-semibold leading-snug">{s}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed" style={{ color: t.sub }}>
                    Done properly, priced fairly, and backed by people who pick up the phone.
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Social proof */}
          <section className="px-5 py-12 sm:px-8" style={{ background: t.panel, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="grid items-center gap-8 md:grid-cols-[1fr_1.4fr]">
              <div>
                <p className="text-5xl font-bold tracking-tight sm:text-6xl" style={{ fontFamily: display, color: t.accent }}>
                  {rating ? rating.toFixed(1) : "★★★★★"}
                </p>
                <p className="mt-1 text-sm" style={{ color: t.sub }}>
                  {rating
                    ? `average from ${dossier.reviews ? `${dossier.reviews} ` : ""}real ${t.proofWord}`
                    : `what your ${t.proofWord} already say — front and center`}
                </p>
              </div>
              <blockquote className="rounded-2xl p-5 sm:p-6" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-[15px] leading-relaxed" style={{ fontFamily: display }}>
                  &ldquo;Your best review goes right here — big, believable, and doing the selling
                  for you before anyone even calls.&rdquo;
                </p>
                <footer className="mt-3 text-[12px]" style={{ color: t.sub }}>
                  — A happy customer{place ? `, ${place}` : ""}
                </footer>
              </blockquote>
            </div>
          </section>

          {/* Final CTA */}
          <section className="px-5 py-12 text-center sm:px-8 sm:py-14" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <h2 className="mx-auto max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={{ fontFamily: display }}>
              Ready to get started?
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: t.sub }}>
              {company.phone ? `One call does it: ${company.phone}` : "One tap and you're on the schedule."}
            </p>
            <span className="mt-6 inline-block rounded-lg px-7 py-3 text-sm font-bold" style={{ background: t.accent, color: t.accentInk }}>
              {t.cta}
            </span>
          </section>

          {/* Mock footer */}
          <footer className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-[11px] sm:px-8" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", color: t.sub }}>
            <span style={{ fontFamily: display }} className="font-bold">{company.name}</span>
            <span>
              {place ? `${place} · ` : ""}
              {company.phone ?? ""}
            </span>
          </footer>
        </div>

        {/* Nexraft close */}
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-signal/40 bg-surface p-6 text-center sm:p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">This is just a taste</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-bone">
            Imagine this live, with your photos and your reviews.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mute">
            We put this concept together from public info about {company.name} — the real thing gets
            your photos, your words, and a design round where you call the shots. Reply to our email
            or give us a call and we&apos;ll take it from here.
          </p>
          <p className="mt-6 text-[11px] text-faint">
            Concept by Nexraft ·{" "}
            <a href="https://nexraft.com" className="text-mute hover:text-bone">nexraft.com</a>
          </p>
        </div>
      </div>
    </div>
  );
}
