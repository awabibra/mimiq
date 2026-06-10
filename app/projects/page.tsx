"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AuthGate } from "@/components/AuthGate";
import { Sidebar } from "@/components/Sidebar";
import {
  consumeEntryProjectsCache,
  consumeEntryVisualHandoff,
} from "@/lib/entryHandoff";
import { getAuthSession } from "@/lib/auth";
import {
  createProjectRecord,
  listProjects,
  saveProjectPatch,
  touchProject,
} from "@/lib/projects";
import type { AudioServiceStatus, GeneratedChain, Project } from "@/lib/types";
import {
  getCurrentVocal,
  getLatestGeneratedChain,
  useProject,
} from "@/lib/useProject";
import { useAudioStore } from "@/lib/useAudioStore";
import { defaultEra, eras } from "@/lib/eras";
import styles from "./page.module.css";

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

function WaveformIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 40" fill="none" aria-hidden="true">
      <path
        d="M3 20h7l4-12 6 24 7-30 8 36 7-24 5 6h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AnalysisProvenance = {
  analysis_version: "1.0";
  fallback_used: boolean;
  audio_service_status: AudioServiceStatus;
};

const SAFE_ANALYSIS_PROVENANCE: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: true,
  audio_service_status: "unknown",
};

function formatDate(value: string | null) {
  if (!value) return "Not opened yet";
  return dateFormat.format(new Date(value));
}

function hashString(value: string) {
  return Array.from(value).reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
    7
  );
}

function artStyleForProject(project: Project, index: number) {
  const seed = hashString(`${project.id}-${project.name}-${index}`);
  const hueA = seed % 360;
  const hueB = (hueA + 72 + (seed % 48)) % 360;
  const hueC = (hueA + 164 + (seed % 38)) % 360;

  return {
    "--art-a": `hsl(${hueA} 78% 46%)`,
    "--art-b": `hsl(${hueB} 86% 52%)`,
    "--art-c": `hsl(${hueC} 68% 34%)`,
    "--art-x": `${32 + (seed % 38)}%`,
    "--art-y": `${26 + ((seed >> 4) % 42)}%`,
  } as CSSProperties;
}

function getProjectArtUrl(project: Project) {
  const visualProject = project as Project & {
    fal_album_art_url?: string | null;
    thumbnail_url?: string | null;
    image_url?: string | null;
  };

  return (
    visualProject.fal_album_art_url ??
    visualProject.thumbnail_url ??
    visualProject.image_url ??
    null
  );
}

function getProjectEra(project: Project) {
  const latestChain = getLatestGeneratedChain(project);
  const eraId = latestChain?.sandbox_settings?.era;
  return (
    eras.find((era) => era.id === eraId) ??
    eras.find((era) => era.name === latestChain?.genre) ??
    defaultEra
  );
}

function getProjectLufs(project: Project) {
  const lufs = getLatestGeneratedChain(project)?.chain_data.measurements?.lufs;
  return typeof lufs === "number" ? `${lufs.toFixed(1)} LUFS` : "-- LUFS";
}

function isProjectReady(project: Project) {
  return Boolean(getLatestGeneratedChain(project));
}

function provenanceFromChainData(
  chainData?: GeneratedChain["chain_data"]
): AnalysisProvenance {
  if (!chainData) return SAFE_ANALYSIS_PROVENANCE;

  return {
    analysis_version: chainData.analysis_version ?? "1.0",
    fallback_used:
      typeof chainData.fallback_used === "boolean"
        ? chainData.fallback_used
        : SAFE_ANALYSIS_PROVENANCE.fallback_used,
    audio_service_status:
      chainData.audio_service_status ?? SAFE_ANALYSIS_PROVENANCE.audio_service_status,
  };
}

function toAudioSession(project: Project) {
  const vocal = getCurrentVocal(project);
  const latestChain = getLatestGeneratedChain(project);
  const chainData = latestChain?.chain_data;
  const xyPosition = chainData?.xyPosition ?? { x: 0.55, y: 0.62 };
  const provenance = provenanceFromChainData(chainData);

  return {
    vocalFileUrl: vocal?.url ?? null,
    beatFileUrl: project.beat_file_url,
    analysisResult: chainData?.measurements
      ? {
          chain: chainData.chain,
          summary: chainData.summary,
          metrics: chainData.measurements,
          xyPosition,
          analysis_version: provenance.analysis_version,
          fallback_used: provenance.fallback_used,
          audio_service_status: provenance.audio_service_status,
        }
      : null,
    processedAnalysis: project.level_lab_report,
    processedFileUrl: project.stem_split_url,
    isAnalyzed: Boolean(vocal || chainData?.measurements),
  };
}

function ProjectsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setActiveProject = useProject((state) => state.setActiveProject);
  const projectPrompt = useProject((state) => state.prompt);
  const setPrompt = useProject((state) => state.setPrompt);
  const setSession = useAudioStore((state) => state.setSession);
  const clearSession = useAudioStore((state) => state.clearSession);
  const [initialProjects] = useState(() => consumeEntryProjectsCache());
  const [entryReveal] = useState(() => consumeEntryVisualHandoff());

  const [projects, setProjects] = useState<Project[]>(() => initialProjects ?? []);
  const [loading, setLoading] = useState(() => initialProjects === null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [beatName, setBeatName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedEraId, setSelectedEraId] = useState(defaultEra.id);

  const routePrompt = searchParams.get("prompt");
  const revealDelay = entryReveal ? 0.22 : 0;
  const subtlePrompt = useMemo(() => {
    if (projectPrompt) return projectPrompt;
    if (routePrompt === "select-project") {
      return "Select or create a session to continue.";
    }
    return null;
  }, [projectPrompt, routePrompt]);
  const headerSubtext = subtlePrompt ?? "Select or create a session to continue.";
  const activeSidebarEra =
    eras.find((era) => era.id === selectedEraId) ?? defaultEra;
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;

    return projects.filter((project) => {
      const era = getProjectEra(project).name.toLowerCase();
      return (
        project.name.toLowerCase().includes(normalized) ||
        (project.beat_filename ?? "").toLowerCase().includes(normalized) ||
        era.includes(normalized)
      );
    });
  }, [projects, query]);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const data = await listProjects();
        if (alive) setProjects(data);
      } catch {
        if (alive) setProjects([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!modalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, modalOpen]);

  const openProject = useCallback(
    async (project: Project) => {
      if (busy) return;
      setBusy(true);
      setSelectedProjectId(project.id);

      try {
        await delay(220);
        const touched = await touchProject(project.id);
        setActiveProject(touched);
        setSession(toAudioSession(touched));
        setPrompt(null);
        setExiting(true);
        await delay(260);
        router.push("/sandbox");
      } catch {
        setSelectedProjectId(null);
        setExiting(false);
        setBusy(false);
      }
    },
    [busy, router, setActiveProject, setPrompt, setSession]
  );

  const createProject = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = name.trim();
      const trimmedBeat = beatName.trim();
      if (!trimmed || busy) return;

      setBusy(true);

      try {
        const auth = await getAuthSession();
        if (!auth) {
          router.replace("/");
          return;
        }

        let project = await createProjectRecord(trimmed, auth.user.id);
        if (!project) throw new Error("Project creation failed");

        if (trimmedBeat) {
          project = await saveProjectPatch(project.id, {
            beat_filename: trimmedBeat,
          });
        }

        setActiveProject(project);
        clearSession();
        setPrompt(null);
        setModalOpen(false);
        router.push("/sandbox");
      } catch (error) {
        console.error("[projects] Project creation failed:", error);
        setBusy(false);
      }
    },
    [beatName, busy, clearSession, name, router, setActiveProject, setPrompt]
  );

  const openModal = useCallback(() => {
    setName("");
    setBeatName("");
    setSelectedEraId(defaultEra.id);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (!busy) setModalOpen(false);
  }, [busy]);

  const stopModalClick = (event: MouseEvent<HTMLFormElement>) => {
    event.stopPropagation();
  };

  const setMagneticPosition = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return (
    <motion.main
      className={styles.shell}
      animate={exiting ? { opacity: 0, y: -18 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
    >
      {entryReveal && (
        <motion.div
          className={styles.entryVeil}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{
            delay: 0.04,
            duration: 0.84,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      )}

      <Sidebar
        activePage="projects"
        activeEra={activeSidebarEra}
        onEraChange={(era) => setSelectedEraId(era.id)}
        savedCount={0}
      />

      <section className={styles.workspace}>
        <motion.header
          className={styles.topBar}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: revealDelay + 0.08,
            duration: 0.42,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        >
          <div className={styles.headerCopy}>
            <h1>Your projects.</h1>
            <p>{headerSubtext}</p>
          </div>

          <div className={styles.headerActions}>
            <label className={styles.searchBox}>
              <SearchIcon className={styles.searchIcon} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sessions"
                aria-label="Search sessions"
              />
            </label>
            <motion.button
              type="button"
              className={styles.newSessionButton}
              onClick={openModal}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <PlusIcon className={styles.buttonIcon} />
              New Session
            </motion.button>
          </div>
        </motion.header>

        <section className={styles.gridRegion}>
          {loading && (
            <div className={styles.projectGrid}>
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <motion.div
                  key={item}
                  className={styles.cardSkeleton}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: revealDelay + item * 0.06,
                    duration: 0.4,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                />
              ))}
            </div>
          )}

          {!loading && filteredProjects.length === 0 && (
            <motion.div
              className={styles.emptyState}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: revealDelay + 0.12,
                duration: 0.4,
                ease: [0.25, 0.46, 0.45, 0.94],
              }}
            >
              <WaveformIcon className={styles.emptyIcon} />
              <h2>No sessions yet.</h2>
              <p>Create one to start building your sound.</p>
              <motion.button
                type="button"
                className={styles.emptyButton}
                onClick={openModal}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <PlusIcon className={styles.buttonIcon} />
                New Session
              </motion.button>
            </motion.div>
          )}

          {!loading && filteredProjects.length > 0 && (
            <motion.div
              className={styles.projectGrid}
              initial="hidden"
              animate="show"
            >
              {filteredProjects.map((project, index) => {
                const selected = selectedProjectId === project.id;
                const era = getProjectEra(project);
                const ready = isProjectReady(project);
                const artUrl = getProjectArtUrl(project);
                const latestChain = getLatestGeneratedChain(project);

                return (
                  <motion.article
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${project.name}`}
                    className={`${styles.projectCard} ${selected ? styles.projectCardSelected : ""}`}
                    custom={index}
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      show: (itemIndex: number) => ({
                        opacity: 1,
                        y: 0,
                        transition: {
                          delay: revealDelay + itemIndex * 0.06,
                          duration: 0.4,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        },
                      }),
                    }}
                    whileHover={{ y: -4, scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                    onMouseMove={setMagneticPosition}
                    onClick={() => openProject(project)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openProject(project);
                      }
                    }}
                  >
                    <div className={styles.artwork} style={artStyleForProject(project, index)}>
                      <div
                        className={`${styles.artworkInner} ${artUrl ? styles.artworkImage : styles.artworkPlaceholder}`}
                        style={artUrl ? { backgroundImage: `url("${artUrl}")` } : undefined}
                      />
                      <div className={styles.artworkShade} />
                      <span
                        className={`${styles.statusDot} ${ready ? styles.statusReady : styles.statusProgress}`}
                        title={ready ? "Ready" : "In Progress"}
                      />
                      <button
                        type="button"
                        className={styles.cardMenu}
                        aria-label="Project actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        ...
                      </button>
                    </div>

                    <div className={styles.cardBody}>
                      <div>
                        <h2>{project.name}</h2>
                        <div className={styles.eraPill}>
                          <span />
                          {era.name}
                        </div>
                      </div>

                      <div className={styles.cardStats}>
                        <span>{project.vocal_versions.length} vocals</span>
                        <span>{project.generated_chains.length} chains</span>
                        <strong>{getProjectLufs(project)}</strong>
                      </div>

                      <div className={styles.cardFooter}>
                        <span>{latestChain?.daw ?? project.beat_filename ?? "No beat yet"}</span>
                        <time>{formatDate(project.last_opened_at)}</time>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
          )}
        </section>
      </section>

      <AnimatePresence>
        {modalOpen && (
          <motion.div
            className={styles.modalBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={closeModal}
          >
            <motion.form
              className={styles.modalCard}
              onMouseDown={stopModalClick}
              onSubmit={createProject}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 32,
                mass: 0.8,
                duration: 0.25,
              }}
            >
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeModal}
                aria-label="Close new session"
              >
                X
              </button>

              <div className={styles.modalHeader}>
                <h2>New session</h2>
                <p>Name the project window MimiQ should remember.</p>
              </div>

              <label className={styles.fieldLabel}>
                Session name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="Midnight demo"
                />
              </label>

              <label className={styles.fieldLabel}>
                Beat name
                <input
                  value={beatName}
                  onChange={(event) => setBeatName(event.target.value)}
                  maxLength={100}
                  placeholder="Optional"
                />
              </label>

              <div className={styles.eraSelector}>
                <span>Vibe</span>
                <div className={styles.eraGrid}>
                  {eras.map((era) => (
                    <button
                      key={era.id}
                      type="button"
                      className={`${styles.eraOption} ${
                        selectedEraId === era.id ? styles.eraOptionActive : ""
                      }`}
                      onClick={() => setSelectedEraId(era.id)}
                    >
                      <span />
                      {era.name}
                    </button>
                  ))}
                </div>
              </div>

              <motion.button
                type="submit"
                className={styles.confirmButton}
                disabled={busy || !name.trim()}
                whileHover={{ scale: busy || !name.trim() ? 1 : 1.02 }}
                whileTap={{ scale: busy || !name.trim() ? 1 : 0.97 }}
                transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                {busy ? "Creating" : "Create Session"}
              </motion.button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.main>
  );
}

export default function ProjectsPage() {
  return (
    <AuthGate allowEntryHandoff>
      <Suspense
        fallback={
          <div className="grid min-h-screen place-items-center bg-[#050505] text-[13px] text-[#8e8e93]">
            Loading sessions
          </div>
        }
      >
        <ProjectsInner />
      </Suspense>
    </AuthGate>
  );
}
