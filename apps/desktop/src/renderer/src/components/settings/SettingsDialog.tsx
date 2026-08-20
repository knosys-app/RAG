import type { SystemStatus } from "@knosys-rag/contracts";
import {
  AlertTriangle,
  ChevronRight,
  Database,
  FileSearch,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ModelsPanel } from "@/components/settings/ModelsPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UseLibrary } from "@/hooks/useLibrary";
import type { UseRagStatus } from "@/hooks/useRagStatus";
import {
  ACCENT_OPTIONS,
  useTheme,
  type AccentPreference,
  type ThemePreference,
} from "@/hooks/useTheme";
import { describeError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { describeOllama } from "@/lib/library-labels";
import { contentTransition, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

type SystemLoadState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly status: SystemStatus }
  | { readonly state: "error"; readonly message: string };

const THEME_OPTIONS: readonly { readonly label: string; readonly value: ThemePreference }[] =
  [
    { label: "System", value: "system" },
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
  ];

const ACCENT_LABELS: Record<AccentPreference, string> = {
  blue: "Blue",
  coral: "Coral",
  green: "Green",
  rose: "Rose",
  violet: "Violet",
};

const SETTINGS_TABS = [
  { label: "General", value: "general" },
  { label: "Models", value: "models" },
  { label: "System", value: "system" },
] as const;

// The sliding pill below supplies the active-tab surface, so the trigger's
// own active background/shadow/border are neutralized (same variant stacks
// as ui/tabs.tsx so tailwind-merge dedupes them).
const TAB_TRIGGER_PILL_OVERRIDES =
  "data-[state=active]:bg-transparent group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent";

const SHORTCUTS: readonly { readonly action: string; readonly keys: readonly string[] }[] =
  [
    { action: "Search the library", keys: ["⌘", "K"] },
    { action: "Send the question", keys: ["Enter"] },
    { action: "Insert a newline", keys: ["Shift", "Enter"] },
    { action: "Send (alternate)", keys: ["⌘", "Enter"] },
  ];

function ReadinessRow({
  detail,
  icon,
  ready,
  readyLabel,
  title,
  waitingLabel,
}: {
  readonly detail: string;
  readonly icon: ReactNode;
  readonly ready: boolean;
  readonly readyLabel: string;
  readonly title: string;
  readonly waitingLabel: string;
}): ReactNode {
  return (
    <li className="flex items-center gap-3 py-2">
      <span aria-hidden="true" className="shrink-0 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-medium">{title}</strong>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
          ready ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {ready ? readyLabel : waitingLabel}
      </span>
    </li>
  );
}

interface SettingsDialogProps {
  readonly library: UseLibrary;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly rag: UseRagStatus;
}

export function SettingsDialog({
  library,
  onOpenChange,
  open,
  rag,
}: SettingsDialogProps): ReactNode {
  const { accent, preference, setAccent, setPreference } = useTheme();
  const [systemState, setSystemState] = useState<SystemLoadState>({ state: "loading" });
  const [activeTab, setActiveTab] = useState<string>("general");
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  const [tabPill, setTabPill] = useState<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  // The dialog re-centers whenever a panel with a different height mounts, so
  // a shared-layoutId pill (which FLIPs between viewport rects) would fly
  // diagonally across that shift. Offsets measured inside the tab list are
  // immune to the dialog moving, keeping the pill's travel horizontal.
  useLayoutEffect(() => {
    if (!open) return;
    const list = tabsListRef.current;
    if (!list) return;
    const measure = (): void => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return;
      setTabPill({
        height: active.offsetHeight,
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [activeTab, open]);

  const inspectSystem = useCallback(async () => {
    setSystemState({ state: "loading" });
    try {
      setSystemState({ state: "ready", status: await window.knosys.system.getStatus() });
    } catch (error) {
      setSystemState({
        message: describeError(error, "Knosys RAG could not inspect this Mac."),
        state: "error",
      });
    }
  }, []);

  useEffect(() => {
    if (open) void inspectSystem();
  }, [inspectSystem, open]);

  const status = systemState.state === "ready" ? systemState.status : null;
  const ollamaReady = status?.ollama.state === "ready";
  const coverage = rag.status?.embedding.coverage ?? null;
  const documents = library.snapshot.documents;
  const totalManagedBytes = documents.reduce(
    (total, document) => total + document.sizeBytes,
    0,
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Settings</DialogTitle>
          <DialogDescription>
            Appearance, local models, and runtime readiness.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          className="min-h-0 flex-1"
          onValueChange={setActiveTab}
          value={activeTab}
        >
          <TabsList className="relative w-full" ref={tabsListRef}>
            {tabPill ? (
              <motion.span
                animate={{ width: tabPill.width, x: tabPill.left }}
                aria-hidden="true"
                className="absolute left-0 rounded-md bg-background shadow-sm"
                initial={false}
                style={{ height: tabPill.height, top: tabPill.top }}
                transition={springSnappy}
              />
            ) : null}
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger
                className={TAB_TRIGGER_PILL_OVERRIDES}
                key={tab.value}
                value={tab.value}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent className="overflow-y-auto pt-2" value="general">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
              initial={{ opacity: 0, y: 4 }}
              transition={contentTransition}
            >
              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Theme
                </h3>
                <fieldset className="flex rounded-lg bg-muted p-0.5">
                  <legend className="sr-only">Theme</legend>
                  {THEME_OPTIONS.map((option) => (
                    <label
                      className={cn(
                        "relative flex-1 cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors",
                        preference === option.value
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      key={option.value}
                    >
                      {preference === option.value ? (
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-md bg-background shadow-sm"
                          layoutId="theme-pref-pill"
                          transition={springSnappy}
                        />
                      ) : null}
                      <input
                        checked={preference === option.value}
                        className="sr-only"
                        name="theme-preference"
                        onChange={() => {
                          setPreference(option.value);
                        }}
                        type="radio"
                        value={option.value}
                      />
                      <span className="relative">{option.label}</span>
                    </label>
                  ))}
                </fieldset>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Accent color
                </h3>
                <div
                  className="flex gap-2 p-1"
                  role="radiogroup"
                  aria-label="Accent color"
                >
                  {ACCENT_OPTIONS.map((option) => (
                    <motion.button
                      aria-checked={accent === option}
                      aria-label={`${ACCENT_LABELS[option]} accent`}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full transition-shadow",
                        accent === option
                          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-background",
                      )}
                      key={option}
                      onClick={() => {
                        setAccent(option);
                      }}
                      role="radio"
                      title={ACCENT_LABELS[option]}
                      transition={springSnappy}
                      type="button"
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.88 }}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-6 rounded-full",
                          option === "violet" && "bg-[oklch(0.6_0.2_305)]",
                          option === "coral" && "bg-[oklch(0.62_0.16_35)]",
                          option === "blue" && "bg-[oklch(0.6_0.17_250)]",
                          option === "green" && "bg-[oklch(0.6_0.14_155)]",
                          option === "rose" && "bg-[oklch(0.63_0.18_10)]",
                        )}
                      />
                    </motion.button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Colors buttons, citation chips, and highlights.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Keyboard shortcuts
                </h3>
                <ul className="divide-y">
                  {SHORTCUTS.map((shortcut) => (
                    <li
                      className="flex items-center justify-between py-2 text-sm"
                      key={shortcut.action}
                    >
                      <span>{shortcut.action}</span>
                      <span className="flex gap-1">
                        {shortcut.keys.map((key) => (
                          <kbd
                            className="rounded border px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground"
                            key={key}
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </motion.div>
          </TabsContent>

          <TabsContent className="overflow-y-auto pt-2" value="models">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 4 }}
              transition={contentTransition}
            >
              <ModelsPanel rag={rag} />
            </motion.div>
          </TabsContent>

          <TabsContent className="overflow-y-auto pt-2" value="system">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
              initial={{ opacity: 0, y: 4 }}
              transition={contentTransition}
            >
              <section className="space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Runtime readiness
                  </h3>
                  <Button
                    disabled={systemState.state === "loading"}
                    onClick={() => void inspectSystem()}
                    size="sm"
                    variant="ghost"
                  >
                    <RefreshCw
                      className={
                        systemState.state === "loading" ? "animate-spin" : undefined
                      }
                      size={14}
                    />
                    Inspect again
                  </Button>
                </div>
                {systemState.state === "error" ? (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
                    role="alert"
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 shrink-0"
                      size={15}
                    />
                    <div>
                      <strong>Inspection failed.</strong>
                      <p className="text-muted-foreground">{systemState.message}</p>
                    </div>
                  </div>
                ) : null}
                <ol aria-live="polite" className="divide-y">
                  <ReadinessRow
                    detail={
                      status
                        ? `${status.macosVersion} · ${status.architecture} · ${formatBytes(status.memoryBytes)}`
                        : "Checking hardware"
                    }
                    icon={<ShieldCheck size={17} />}
                    ready={status?.support.supported === true}
                    readyLabel="Ready"
                    title="Supported Mac"
                    waitingLabel={systemState.state === "loading" ? "Checking" : "Review"}
                  />
                  <ReadinessRow
                    detail={
                      status ? describeOllama(status.ollama) : "Checking loopback API"
                    }
                    icon={<Database size={17} />}
                    ready={ollamaReady}
                    readyLabel="Running"
                    title="Ollama runtime"
                    waitingLabel={systemState.state === "loading" ? "Checking" : "Offline"}
                  />
                  <ReadinessRow
                    detail={
                      coverage
                        ? `${Math.round(coverage.ratio * 100)}% embedded · ${rag.status?.embedding.model.model ?? ""}`
                        : "Lexical fallback remains available"
                    }
                    icon={<FileSearch size={17} />}
                    ready={coverage?.ratio === 1}
                    readyLabel="Ready"
                    title="Semantic index"
                    waitingLabel="Fallback"
                  />
                </ol>
                {!ollamaReady && systemState.state !== "loading" ? (
                  <a
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    href="https://ollama.com/download/mac"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open official Ollama download <ChevronRight size={14} />
                  </a>
                ) : null}
                {systemState.state === "loading" ? (
                  <p
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle aria-hidden="true" className="animate-spin" size={13} />
                    Inspecting this Mac
                  </p>
                ) : null}
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Storage
                </h3>
                <ReadinessRow
                  detail={`${documents.length} ${documents.length === 1 ? "source" : "sources"} in app-managed local storage`}
                  icon={<HardDrive size={17} />}
                  ready={documents.length > 0}
                  readyLabel={formatBytes(totalManagedBytes)}
                  title="Library storage"
                  waitingLabel="Empty"
                />
              </section>

              <p className="text-xs text-muted-foreground">
                Knosys RAG {status ? `v${status.appVersion}` : ""} · Everything stays on
                this Mac.
              </p>
            </motion.div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
