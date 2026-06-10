"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getEraById } from "@/lib/eras";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import styles from "./AccountSettingsPanel.module.css";

type ThemeName = "dark" | "beige";
type ActivityType = "chain" | "vocal" | "stem";

interface AccountSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ProjectUsageRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  generated_chains: unknown;
  mix_room_report: unknown;
  level_lab_report: unknown;
  stem_split_url: string | null;
  last_opened_at: string;
}

interface GeneratedChainRecord {
  id: string;
  chain_data: Record<string, unknown>;
  genre?: unknown;
  daw?: unknown;
  created_at?: unknown;
  sandbox_settings?: unknown;
}

interface GenreStat {
  id: string;
  name: string;
  count: number;
  percentage: number;
  isTop: boolean;
}

interface UsageActivity {
  id: string;
  type: ActivityType;
  text: string;
  timestamp: string;
  sortTime: number;
}

interface LufsPoint {
  value: number;
  sortTime: number;
}

interface UsageAnalytics {
  sessionCount: number;
  chainCount: number;
  topGenre: string;
  genres: GenreStat[];
  activities: UsageActivity[];
  lufsPoints: LufsPoint[];
}

interface UsageState {
  loading: boolean;
  data: UsageAnalytics;
}

const THEME_STORAGE_KEY = "mimiq-theme";
const snapEase = [0.16, 1, 0.3, 1] as const;
const emptyUsageAnalytics: UsageAnalytics = {
  sessionCount: 0,
  chainCount: 0,
  topGenre: "—",
  genres: [],
  activities: [],
  lufsPoints: [],
};

const activityDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function displayNameFor(user: User | null) {
  const metadata = user?.user_metadata as
    | { full_name?: string; name?: string; display_name?: string }
    | undefined;

  return (
    metadata?.display_name ||
    metadata?.full_name ||
    metadata?.name ||
    user?.email?.split("@")[0] ||
    "Artist"
  );
}

function planFor(user: User | null) {
  const metadata = {
    ...(user?.app_metadata ?? {}),
    ...(user?.user_metadata ?? {}),
  } as { plan?: string; subscription?: string; tier?: string };
  const plan = `${metadata.plan || metadata.subscription || metadata.tier || ""}`.toLowerCase();

  return plan.includes("pro") ? "Pro Plan" : "Free";
}

function initialFor(name: string, email?: string) {
  return (name || email || "A").trim().slice(0, 1).toUpperCase();
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFrom(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timeFrom(value: unknown) {
  const text = textFrom(value);
  if (!text) return 0;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : 0;
}

function formatActivityTimestamp(sortTime: number) {
  if (!sortTime) return "Recently";

  const elapsed = Date.now() - sortTime;
  const day = 24 * 60 * 60 * 1000;

  if (elapsed >= 0 && elapsed < day) return "Today";
  if (elapsed >= day && elapsed < day * 2) return "Yesterday";
  if (elapsed >= day * 2 && elapsed < day * 7) return `${Math.floor(elapsed / day)}d ago`;

  return activityDateFormat.format(new Date(sortTime));
}

function labelFromId(id: string) {
  const era = getEraById(id);
  if (era) return era.name;

  return id
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isGeneratedChainRecord(value: unknown): value is GeneratedChainRecord {
  if (!isRecord(value)) return false;

  return typeof value.id === "string" && isRecord(value.chain_data) && Array.isArray(value.chain_data.chain);
}

function getProjectChains(project: ProjectUsageRow) {
  return Array.isArray(project.generated_chains)
    ? project.generated_chains.filter(isGeneratedChainRecord)
    : [];
}

function chainEra(chain: GeneratedChainRecord) {
  const settings = isRecord(chain.sandbox_settings) ? chain.sandbox_settings : null;

  return (
    (settings ? textFrom(settings.era) : null) ||
    textFrom(chain.genre) ||
    textFrom(chain.chain_data.genre) ||
    null
  );
}

function chainLufs(chain: GeneratedChainRecord) {
  const measurements = isRecord(chain.chain_data.measurements) ? chain.chain_data.measurements : null;

  return measurements
    ? numberFrom(measurements.lufs) ?? numberFrom(measurements.lufs_integrated)
    : null;
}

function latestChain(chains: GeneratedChainRecord[]) {
  return [...chains].sort((a, b) => timeFrom(b.created_at) - timeFrom(a.created_at))[0] ?? null;
}

function projectEra(project: ProjectUsageRow, chains: GeneratedChainRecord[]) {
  const chain = latestChain(chains);
  if (chain) {
    const era = chainEra(chain);
    if (era) return era;
  }

  const mixRoom = isRecord(project.mix_room_report) ? project.mix_room_report : null;
  return mixRoom ? textFrom(mixRoom.genre) : null;
}

function projectLufs(project: ProjectUsageRow, chains: GeneratedChainRecord[]) {
  const levelLab = isRecord(project.level_lab_report) ? project.level_lab_report : null;
  const processed = levelLab && isRecord(levelLab.processedMetrics) ? levelLab.processedMetrics : null;
  const processedLufs = processed
    ? numberFrom(processed.lufs) ?? numberFrom(processed.lufs_integrated)
    : null;

  if (processedLufs !== null) return processedLufs;

  const chain = latestChain(chains);
  return chain ? chainLufs(chain) : null;
}

function addActivity(activities: UsageActivity[], activity: Omit<UsageActivity, "timestamp">) {
  activities.push({
    ...activity,
    timestamp: formatActivityTimestamp(activity.sortTime),
  });
}

function buildUsageAnalytics(projects: ProjectUsageRow[]): UsageAnalytics {
  const genreCounts = new Map<string, number>();
  const activities: UsageActivity[] = [];
  const lufsPoints: LufsPoint[] = [];
  let chainCount = 0;

  projects.forEach((project) => {
    const chains = getProjectChains(project);
    chainCount += chains.length;

    const eraId = projectEra(project, chains);
    if (eraId) {
      genreCounts.set(eraId, (genreCounts.get(eraId) ?? 0) + 1);
    }

    chains.forEach((chain) => {
      const sortTime = timeFrom(chain.created_at) || timeFrom(project.updated_at) || timeFrom(project.created_at);
      const eraName = labelFromId(chainEra(chain) ?? "custom");

      addActivity(activities, {
        id: `chain-${project.id}-${chain.id}`,
        type: "chain",
        text: `Generated a ${eraName} chain`,
        sortTime,
      });
    });

    const mixRoom = isRecord(project.mix_room_report) ? project.mix_room_report : null;
    if (mixRoom) {
      addActivity(activities, {
        id: `mix-${project.id}`,
        type: "vocal",
        text: `Analyzed vocal in Mix Room on ${project.name}`,
        sortTime: timeFrom(mixRoom.analyzed_at) || timeFrom(project.updated_at),
      });
    }

    const levelLab = isRecord(project.level_lab_report) ? project.level_lab_report : null;
    if (levelLab) {
      addActivity(activities, {
        id: `level-${project.id}`,
        type: "vocal",
        text: `Checked LUFS on ${project.name}`,
        sortTime: timeFrom(project.updated_at),
      });
    }

    if (project.stem_split_url) {
      addActivity(activities, {
        id: `stem-${project.id}`,
        type: "stem",
        text: `Split stems on ${project.name}`,
        sortTime: timeFrom(project.updated_at) || timeFrom(project.last_opened_at),
      });
    }

    const lufs = projectLufs(project, chains);
    if (lufs !== null) {
      lufsPoints.push({
        value: lufs,
        sortTime: timeFrom(project.last_opened_at) || timeFrom(project.updated_at) || timeFrom(project.created_at),
      });
    }
  });

  const topCount = Math.max(0, ...genreCounts.values());
  const genres = Array.from(genreCounts.entries())
    .map(([id, count]) => ({
      id,
      name: labelFromId(id),
      count,
      percentage: topCount ? Math.max(8, (count / topCount) * 100) : 0,
      isTop: false,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((genre, index) => ({
      ...genre,
      isTop: index === 0,
    }));

  return {
    sessionCount: projects.length,
    chainCount,
    topGenre: genres[0]?.name ?? "—",
    genres,
    activities: activities.sort((a, b) => b.sortTime - a.sortTime).slice(0, 5),
    lufsPoints: lufsPoints.sort((a, b) => a.sortTime - b.sortTime).slice(-8),
  };
}

function UsageIcon({ type }: { type: ActivityType }) {
  if (type === "stem") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 3v10M8 2v12M12 4v8" />
      </svg>
    );
  }

  if (type === "vocal") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.5v7" />
        <path d="M5.5 4.5v3a2.5 2.5 0 0 0 5 0v-3" />
        <path d="M4 8.2a4 4 0 0 0 8 0M8 12.2V14" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.2 5.1 4.9 3.8a2.4 2.4 0 1 0-3.4 3.4l1.3 1.3" />
      <path d="m9.8 10.9 1.3 1.3a2.4 2.4 0 1 0 3.4-3.4l-1.3-1.3" />
      <path d="m5.7 10.3 4.6-4.6" />
    </svg>
  );
}

function UsageSkeleton() {
  return (
    <section className={`${styles.section} ${styles.analyticsSection}`} aria-label="Usage analytics">
      <div className={styles.analyticsHeading}>
        <span className={styles.analyticsKicker}>Your studio story</span>
        <span className={styles.analyticsTitleSkeleton} />
      </div>
      <div className={styles.statsGrid}>
        <span className={styles.skeletonStat} />
        <span className={styles.skeletonStat} />
        <span className={styles.skeletonStat} />
      </div>
      <div className={styles.skeletonStack}>
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLineShort} />
        <span className={styles.skeletonLine} />
      </div>
    </section>
  );
}

function LufsSparkline({ points }: { points: LufsPoint[] }) {
  if (points.length < 3) return null;

  const width = 284;
  const height = 76;
  const padding = 8;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const plotted = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y = padding + ((max - point.value) / range) * (height - padding * 2);

    return { x, y };
  });
  const linePath = plotted.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const fillPath = `${linePath} L ${plotted[plotted.length - 1].x} ${height - padding} L ${plotted[0].x} ${
    height - padding
  } Z`;

  return (
    <div className={styles.sparklineBlock}>
      <div className={styles.soundHeader}>
        <span>LUFS history</span>
        <span className={styles.sparklineMeta}>Last {points.length} sessions</span>
      </div>
      <svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="LUFS history">
        <path className={styles.sparklineAxis} d={`M ${padding} ${height - padding} H ${width - padding}`} />
        <path className={styles.sparklineFill} d={fillPath} />
        <path className={styles.sparklineLine} d={linePath} />
      </svg>
    </div>
  );
}

function UsageAnalyticsSection({ usage }: { usage: UsageState }) {
  if (usage.loading) return <UsageSkeleton />;

  const { data } = usage;

  return (
    <section className={`${styles.section} ${styles.analyticsSection}`} aria-label="Usage analytics">
      <div className={styles.analyticsHeading}>
        <span className={styles.analyticsKicker}>Your studio story</span>
        <span className={styles.analyticsTitle}>A quick read on your MimiQ run so far.</span>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statItem}>
          <strong className={styles.statValue}>{data.sessionCount}</strong>
          <span className={styles.statLabel}>Total sessions</span>
        </div>
        <div className={styles.statItem}>
          <strong className={styles.statValue}>{data.chainCount}</strong>
          <span className={styles.statLabel}>Total chains generated</span>
        </div>
        <div className={styles.statItem}>
          <strong className={styles.statValue} title={data.topGenre}>
            {data.topGenre}
          </strong>
          <span className={styles.statLabel}>Most used genre</span>
        </div>
      </div>

      <div className={styles.soundBlock}>
        <div className={styles.soundHeader}>
          <span>Your sound</span>
          {data.genres.length > 0 && <span className={styles.soundMeta}>{data.genres.length} presets</span>}
        </div>
        {data.genres.length > 0 ? (
          <div className={styles.genreBars}>
            {data.genres.map((genre, index) => (
              <div className={styles.genreRow} key={genre.id}>
                <div className={styles.genreMeta}>
                  <span className={styles.genreName}>{genre.name}</span>
                  <span className={styles.genreCount}>{genre.count}</span>
                </div>
                <div className={styles.genreTrack}>
                  <motion.span
                    className={`${styles.genreFill} ${genre.isTop ? styles.genreFillTop : styles.genreFillRest}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.4, delay: index * 0.06, ease: snapEase }}
                    style={{ width: `${genre.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.storyFallback}>Your story is just getting started.</p>
        )}
      </div>

      <div className={styles.activityBlock}>
        <div className={styles.soundHeader}>
          <span>Recent activity</span>
        </div>
        {data.activities.length > 0 ? (
          <div className={styles.activityFeed}>
            {data.activities.map((activity) => (
              <div className={styles.activityItem} key={activity.id}>
                <span className={styles.activityIcon}>
                  <UsageIcon type={activity.type} />
                </span>
                <span className={styles.activityText}>{activity.text}</span>
                <time className={styles.activityTime}>{activity.timestamp}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.storyFallback}>Your story is just getting started.</p>
        )}
      </div>

      <LufsSparkline points={data.lufsPoints} />
    </section>
  );
}

export function AccountSettingsPanel({ open, onClose }: AccountSettingsPanelProps) {
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "beige" ? "beige" : "dark";
  });
  const [usage, setUsage] = useState<UsageState>({
    loading: false,
    data: emptyUsageAnalytics,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const name = useMemo(() => displayNameFor(user), [user]);
  const email = user?.email ?? "No email on file";
  const plan = useMemo(() => planFor(user), [user]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open || !user?.id) return;

    let alive = true;
    const userId = user.id;

    async function loadUsage() {
      await Promise.resolve();
      if (!alive) return;

      setUsage({
        loading: true,
        data: emptyUsageAnalytics,
      });

      try {
        const { data, error } = await supabase
          .from("projects")
          .select(
            "id,name,created_at,updated_at,generated_chains,mix_room_report,level_lab_report,stem_split_url,last_opened_at"
          )
          .eq("user_id", userId)
          .order("last_opened_at", { ascending: false });

        if (error) throw error;
        if (!alive) return;

        setUsage({
          loading: false,
          data: buildUsageAnalytics((data ?? []) as ProjectUsageRow[]),
        });
      } catch {
        if (!alive) return;
        setUsage({
          loading: false,
          data: emptyUsageAnalytics,
        });
      }
    }

    void loadUsage();

    return () => {
      alive = false;
    };
  }, [open, user?.id]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const chooseTheme = (nextTheme: ThemeName) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  const sendPasswordReset = async () => {
    if (!user?.email || busy) {
      setMessage("No email is available for this account.");
      return;
    }

    setBusy(true);
    setMessage(null);

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/projects")}`,
    });

    setBusy(false);
    setMessage(error ? error.message : "Password reset email sent.");
  };

  const handleDeleteAccount = () => {
    const confirmed = window.confirm(
      "Delete account requests are handled by support. Do you want contact guidance?"
    );

    if (confirmed) {
      setMessage("Contact support to delete your MimiQ account.");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: snapEase }}
            onClick={onClose}
          />
          <motion.aside
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label="Account settings"
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ duration: 0.25, ease: snapEase }}
          >
            <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close settings">
              X
            </button>

            <header className={styles.profileHeader}>
              <div className={styles.avatar}>{initialFor(name, user?.email)}</div>
              <div className={styles.profileCopy}>
                <div className={styles.displayName}>{name}</div>
                <div className={styles.email}>{email}</div>
                <span className={styles.planBadge}>{plan}</span>
              </div>
            </header>

            <UsageAnalyticsSection usage={user?.id ? usage : { loading: false, data: emptyUsageAnalytics }} />

            <section className={styles.section}>
              <h2 className={styles.sectionLabel}>Appearance</h2>
              <div className={styles.themeGrid} role="radiogroup" aria-label="Appearance">
                <button
                  type="button"
                  className={`${styles.themeOption} ${theme === "dark" ? styles.themeOptionActive : ""}`}
                  onClick={() => chooseTheme("dark")}
                  role="radio"
                  aria-checked={theme === "dark"}
                >
                  <span className={`${styles.themeSwatch} ${styles.darkSwatch}`} />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  className={`${styles.themeOption} ${styles.beigeOption} ${
                    theme === "beige" ? styles.themeOptionActive : ""
                  }`}
                  onClick={() => chooseTheme("beige")}
                  role="radio"
                  aria-checked={theme === "beige"}
                >
                  <span className={`${styles.themeSwatch} ${styles.beigeSwatch}`} />
                  <span>Beige</span>
                </button>
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.actionStack}>
                <button type="button" className={styles.ghostButton} onClick={() => void signOut()}>
                  Sign out
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => void sendPasswordReset()}
                  disabled={busy}
                >
                  {busy ? "Sending..." : "Change password"}
                </button>
              </div>
            </section>

            <section className={`${styles.section} ${styles.dangerSection}`}>
              <button type="button" className={styles.deleteButton} onClick={handleDeleteAccount}>
                Delete account
              </button>
            </section>

            {message && <div className={styles.message}>{message}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
