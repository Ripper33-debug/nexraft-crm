import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import appMetaJson from "../app-meta.json";

const DEFAULT_TITLE = "Nexraft CRM";
const DEFAULT_DESCRIPTION = "Nexraft's internal sales CRM — pipeline, contacts, and follow-ups.";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
  og_video_url?: string | null;
};

const appMeta = appMetaJson as AppMeta;

const APP_HOST_ZONES = ["higgsfield.app", "higgsfield-dev.app"];

function toOwnAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const u = new URL(value);
    const isAppHost = APP_HOST_ZONES.some(
      (zone) => u.hostname === zone || u.hostname.endsWith(`.${zone}`),
    );
    if (isAppHost) return u.pathname + u.search;
    return value;
  } catch {
    return value;
  }
}

function buildHead(meta: AppMeta) {
  const title = meta.og_title ?? DEFAULT_TITLE;
  const description = meta.og_description ?? DEFAULT_DESCRIPTION;
  const ogImage = toOwnAssetUrl(meta.og_image_url);
  const favicon = toOwnAssetUrl(meta.favicon_url);
  const ogVideo = toOwnAssetUrl(meta.og_video_url);

  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title },
      { name: "description", content: description },
      { name: "author", content: "Nexraft" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { name: "twitter:image", content: ogImage },
          ]
        : []),
      ...(ogVideo ? [{ property: "og:video", content: ogVideo }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Custom favicon override wins; otherwise fall back to the bundled brand mark.
      favicon
        ? { rel: "icon", href: favicon }
        : { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  };
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4">
      <div className="max-w-md text-center">
        <div className="text-4xl font-bold text-bone">404</div>
        <p className="mt-2 text-mute">This page doesn't exist.</p>
        <a
          href="/"
          className="mt-4 inline-block rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-ink hover:bg-signal-strong"
        >
          Go home
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-bone">This page didn't load</h1>
        <p className="mt-2 text-sm text-mute">
          Something went wrong. Try refreshing or head back home.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-ink hover:bg-signal-strong"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-bone hover:bg-surface-2"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => buildHead(appMeta),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Runs before first paint so the saved theme is applied with no flash. Mirrors
// the logic in src/lib/crm/theme.ts (kept inline + dependency-free on purpose).
const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('nx-theme')||'daylight';var t=p;if(p==='system'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'daylight':'midnight';}document.documentElement.setAttribute('data-theme',t==='daylight'?'daylight':'midnight');}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="daylight">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-ink text-bone antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
