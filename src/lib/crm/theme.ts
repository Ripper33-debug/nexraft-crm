// Client-side theme control for the Nexraft app shell.
//
// Two visual skins ship in styles.css: "midnight" (the default dark shell,
// applied when data-theme is anything other than "daylight") and "daylight"
// (a warm light mode, applied via :root[data-theme="daylight"]). Users pick
// Midnight, Daylight, or System (follow OS). The choice is persisted in
// localStorage under `nx-theme`; a blocking <script> in __root.tsx reads the
// same key before first paint so there's no theme flash on load.

export type ThemePref = "midnight" | "daylight" | "system";
export type ResolvedTheme = "midnight" | "daylight";

export const THEME_STORAGE_KEY = "nx-theme";
// The app ships dark-only now — every preference resolves to the midnight skin.
export const DEFAULT_THEME_PREF: ThemePref = "midnight";

function isPref(v: unknown): v is ThemePref {
  return v === "midnight" || v === "daylight" || v === "system";
}

/** Read the saved preference (defaults to Midnight). Safe on the server. */
export function getThemePref(): ThemePref {
  if (typeof window === "undefined") return DEFAULT_THEME_PREF;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(v) ? v : DEFAULT_THEME_PREF;
  } catch {
    return DEFAULT_THEME_PREF;
  }
}

/** Dark-only build: the app always resolves to the midnight skin. */
export function systemTheme(): ResolvedTheme {
  return "midnight";
}

/** Turn a preference into the concrete skin to apply. Dark-only for now, so
 * any saved preference (including a stale "daylight") resolves to midnight. */
export function resolveTheme(_pref: ThemePref): ResolvedTheme {
  return "midnight";
}

/** Apply a resolved skin to the document root (sets data-theme). */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

/** Persist a preference and apply it immediately. */
export function setThemePref(pref: ThemePref): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // ignore write failures (private mode, etc.)
    }
  }
  applyResolvedTheme(resolveTheme(pref));
}

/**
 * Keep the applied skin in sync with the OS when the preference is "system".
 * Returns an unsubscribe function. No-op on the server.
 */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (getPref() === "system") applyResolvedTheme(systemTheme());
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
