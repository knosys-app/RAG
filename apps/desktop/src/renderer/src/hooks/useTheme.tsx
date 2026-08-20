import {
  accentPreferenceSchema,
  type AccentPreference,
  type AppPreferencesPatch,
  type KnosysDesktopApi,
  type ThemePreference,
} from "@knosys-rag/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type { AccentPreference, ThemePreference };
export type ResolvedTheme = "light" | "dark";

export const ACCENT_OPTIONS: readonly AccentPreference[] =
  accentPreferenceSchema.options;

// localStorage is only a same-session cache: the dev server and the packaged
// app are different origins, so durable preferences go through the main
// process via preferences.get/set. Feature-detected so tests and older
// preloads without the namespace stay harmless.
function preferencesApi(): KnosysDesktopApi["preferences"] | undefined {
  return (window as { knosys?: Partial<KnosysDesktopApi> }).knosys?.preferences;
}

const STORAGE_KEY = "knosys.theme";
const ACCENT_STORAGE_KEY = "knosys.accent";

interface ThemeContextValue {
  readonly accent: AccentPreference;
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setAccent: (accent: AccentPreference) => void;
  readonly setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage can be unavailable; fall back to the system preference.
  }
  return "system";
}

function readStoredAccent(): AccentPreference {
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if ((ACCENT_OPTIONS as readonly string[]).includes(stored ?? "")) {
      return stored as AccentPreference;
    }
  } catch {
    // localStorage can be unavailable; fall back to the default accent.
  }
  return "violet";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference);
  const [accent, setAccentState] = useState<AccentPreference>(readStoredAccent);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  const accentRef = useRef(accent);
  accentRef.current = accent;

  useEffect(() => {
    const api = preferencesApi();
    if (!api) return;
    let active = true;
    void api
      .get()
      .then((stored) => {
        if (!active) return;
        // Durable values win; unset ones are migrated from this origin's cache.
        const patch: AppPreferencesPatch = {};
        if (stored.theme !== null) setPreferenceState(stored.theme);
        else if (preferenceRef.current !== "system") patch.theme = preferenceRef.current;
        if (stored.accent !== null) setAccentState(stored.accent);
        else if (accentRef.current !== "violet") patch.accent = accentRef.current;
        if (patch.theme !== undefined || patch.accent !== undefined) {
          void api.set(patch).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystem(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  const resolved: ResolvedTheme = preference === "system" ? system : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === "violet") delete root.dataset.accent;
    else root.dataset.accent = accent;
  }, [accent]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting the preference is best-effort.
    }
    void preferencesApi()?.set({ theme: next }).catch(() => undefined);
  }, []);

  const setAccent = useCallback((next: AccentPreference) => {
    setAccentState(next);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      // Persisting the preference is best-effort.
    }
    void preferencesApi()?.set({ accent: next }).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ accent, preference, resolved, setAccent, setPreference }),
    [accent, preference, resolved, setAccent, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme requires a ThemeProvider.");
  }
  return context;
}
