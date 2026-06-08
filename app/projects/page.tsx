"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AuthGate } from "@/components/AuthGate";
import { getAuthSession } from "@/lib/auth";
import {
  createProjectRecord,
  listProjects,
  saveProjectPatch,
  touchProject,
} from "@/lib/projects";
import type { Project } from "@/lib/types";
import {
  getCurrentVocal,
  getLatestGeneratedChain,
  useProject,
} from "@/lib/useProject";
import { useAudioStore } from "@/lib/useAudioStore";

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

function Wordmark() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="fixed left-1/2 top-8 z-20 -translate-x-1/2 text-[14px] font-medium text-[#8e8e93] [letter-spacing:0]"
    >
      MimiQ
    </motion.div>
  );
}

function BreathingWaveform() {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.56, ease: [0.16, 1, 0.3, 1] }}
        className="mimiq-projects-waveform"
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
      </motion.div>
      <style>{`
        .mimiq-projects-waveform {
          align-items: center;
          animation: mimiq-projects-breathe 2s ease-in-out infinite alternate;
          display: flex;
          flex-direction: column;
          gap: 10px;
          height: 54px;
          justify-content: center;
          margin: 0 auto;
          transform-origin: center;
          width: 176px;
        }

        .mimiq-projects-waveform span {
          animation: mimiq-projects-line-breathe 2s ease-in-out infinite alternate;
          background: rgba(215, 255, 63, 0.58);
          border-radius: 999px;
          display: block;
          height: 2px;
        }

        .mimiq-projects-waveform span:nth-child(1) {
          opacity: 0.38;
          width: 112px;
        }

        .mimiq-projects-waveform span:nth-child(2) {
          animation-delay: 120ms;
          opacity: 0.62;
          width: 176px;
        }

        .mimiq-projects-waveform span:nth-child(3) {
          animation-delay: 240ms;
          opacity: 0.34;
          width: 88px;
        }

        @keyframes mimiq-projects-breathe {
          from {
            opacity: 0.5;
            transform: scale(0.95);
          }

          to {
            opacity: 1;
            transform: scale(1.05);
          }
        }

        @keyframes mimiq-projects-line-breathe {
          from {
            height: 2px;
          }

          to {
            height: 4px;
          }
        }
      `}</style>
    </>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDate(value: string | null) {
  if (!value) return "Not opened yet";
  return dateFormat.format(new Date(value));
}

function toAudioSession(project: Project) {
  const vocal = getCurrentVocal(project);
  const latestChain = getLatestGeneratedChain(project);
  const chainData = latestChain?.chain_data;
  const xyPosition = chainData?.xyPosition ?? { x: 0.55, y: 0.62 };

  return {
    vocalFileUrl: vocal?.url ?? null,
    beatFileUrl: project.beat_file_url,
    analysisResult: chainData?.measurements
      ? {
          chain: chainData.chain,
          summary: chainData.summary,
          metrics: chainData.measurements,
          xyPosition,
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

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [beatName, setBeatName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  const routePrompt = searchParams.get("prompt");
  const subtlePrompt = useMemo(() => {
    if (projectPrompt) return projectPrompt;
    if (routePrompt === "select-project") {
      return "Select or create a session to continue.";
    }
    return null;
  }, [projectPrompt, routePrompt]);
  const headerSubtext = subtlePrompt ?? "Select or create a session to continue.";

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
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (!busy) setModalOpen(false);
  }, [busy]);

  const stopModalClick = (event: MouseEvent<HTMLFormElement>) => {
    event.stopPropagation();
  };

  return (
    <motion.main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-x-hidden bg-[#050505] px-6 py-24 text-[#f5f5f7] sm:px-8"
      style={
        {
          "--accent": "#d7ff3f",
          fontFamily: "var(--font-body)",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          textRendering: "optimizeLegibility",
        } as React.CSSProperties
      }
      animate={exiting ? { opacity: 0, y: -18 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
    >
      <Wordmark />

      <section className="relative z-10 flex w-full flex-1 -translate-y-[5%] flex-col items-center justify-center text-center">
        <div className="mx-auto flex w-full max-w-[480px] flex-col items-center">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.15,
              duration: 0.62,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="text-[48px] font-medium leading-none text-white [letter-spacing:0]"
          >
            Your sessions.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.24,
              duration: 0.52,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="mt-3 text-[14px] leading-6 text-[#8e8e93] [letter-spacing:0]"
          >
            {headerSubtext}
          </motion.p>

          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.56, ease: [0.16, 1, 0.3, 1] }}
              className="mt-16 grid w-full grid-cols-1 gap-4"
            >
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-20 animate-pulse rounded-[12px] border border-[#242424] bg-white/[0.025]"
                />
              ))}
            </motion.div>
          )}

          {!loading && projects.length === 0 && (
            <>
              <div className="mt-12">
                <BreathingWaveform />
              </div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
                className="mt-10 grid gap-2"
              >
                <h2 className="text-[16px] font-medium text-white [letter-spacing:0]">
                  No sessions yet.
                </h2>
                <p className="text-[14px] leading-6 text-[#8e8e93] [letter-spacing:0]">
                  Create one and MimiQ tracks everything.
                </p>
              </motion.div>

              <motion.button
                type="button"
                onClick={openModal}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-full border border-[#d7ff3f] bg-[#d7ff3f] px-8 py-4 text-[15px] font-medium text-[#050505] shadow-[0_18px_70px_rgba(215,255,63,0.15)]"
              >
                <PlusIcon className="h-4 w-4" />
                New Session
              </motion.button>
            </>
          )}
        </div>

        {!loading && projects.length > 0 && (
          <>
            <motion.div
              className="mt-16 grid w-full max-w-6xl grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: {
                  transition: {
                    staggerChildren: 0.08,
                    delayChildren: 0.3,
                  },
                },
              }}
            >
              {projects.map((project) => {
                const selected = selectedProjectId === project.id;
                return (
                  <motion.button
                    key={project.id}
                    type="button"
                    onClick={() => openProject(project)}
                    className="group relative min-h-[300px] overflow-hidden rounded-[18px] border border-[#242424] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.016))] p-6 text-left shadow-[0_22px_80px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.07)] outline-none"
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      show: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.58, ease: [0.16, 1, 0.3, 1] },
                      },
                    }}
                    animate={
                      selected
                        ? {
                            scale: [1, 1.02, 0.985],
                            borderColor: ["#242424", "#d7ff3f", "#d7ff3f"],
                          }
                        : undefined
                    }
                    whileHover={{
                      scale: 1.02,
                      borderColor: "rgba(255,255,255,0.18)",
                      boxShadow:
                        "0 32px 100px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.1)",
                    }}
                    whileTap={{ scale: 0.985 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.14]" />
                    <div className="flex h-full flex-col justify-between gap-12">
                      <div className="grid gap-3">
                        <p className="text-[12px] text-[#737378] [letter-spacing:0]">
                          Last opened {formatDate(project.last_opened_at)}
                        </p>
                        <h2 className="text-[28px] font-semibold leading-tight [letter-spacing:0]">
                          {project.name}
                        </h2>
                      </div>

                      <div className="grid gap-4">
                        <div className="text-[13px] leading-5 text-[#9a9a9f]">
                          {project.beat_filename ?? "No beat yet"}
                        </div>
                        <div className="grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-4">
                          <div>
                            <div className="text-[22px] font-semibold [letter-spacing:0]">
                              {project.vocal_versions.length}
                            </div>
                            <div className="mt-1 text-[12px] text-[#737378]">
                              vocals
                            </div>
                          </div>
                          <div>
                            <div className="text-[22px] font-semibold [letter-spacing:0]">
                              {project.generated_chains.length}
                            </div>
                            <div className="mt-1 text-[12px] text-[#737378]">
                              chains
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>

            <motion.button
              type="button"
              onClick={openModal}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-full border border-[#d7ff3f] bg-[#d7ff3f] px-8 py-4 text-[15px] font-medium text-[#050505] shadow-[0_18px_70px_rgba(215,255,63,0.15)]"
            >
              <PlusIcon className="h-4 w-4" />
              New Session
            </motion.button>
          </>
        )}
      </section>

      <AnimatePresence>
        {modalOpen && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5 backdrop-blur-[16px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onMouseDown={closeModal}
          >
            <motion.form
              onMouseDown={stopModalClick}
              onSubmit={createProject}
              className="grid w-full max-w-[420px] gap-5 rounded-[24px] border border-white/[0.09] bg-white/[0.03] p-6 shadow-[0_32px_100px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.08)]"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="grid gap-2">
                <h2 className="text-[22px] font-semibold [letter-spacing:0]">
                  New session
                </h2>
                <p className="text-[14px] leading-6 text-[#9a9a9f]">
                  Name the project window MimiQ should remember.
                </p>
              </div>

              <label className="grid gap-2 text-[12px] font-medium text-[#8e8e93]">
                Session name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  required
                  maxLength={80}
                  className="h-12 rounded-[14px] border border-white/[0.09] bg-black/55 px-4 text-[15px] font-normal text-[#f5f5f7] outline-none transition duration-200 placeholder:text-[#4d4d52] focus:border-white/[0.18]"
                  placeholder="Midnight demo"
                />
              </label>

              <label className="grid gap-2 text-[12px] font-medium text-[#8e8e93]">
                Beat name
                <input
                  value={beatName}
                  onChange={(event) => setBeatName(event.target.value)}
                  maxLength={100}
                  className="h-12 rounded-[14px] border border-white/[0.09] bg-black/55 px-4 text-[15px] font-normal text-[#f5f5f7] outline-none transition duration-200 placeholder:text-[#4d4d52] focus:border-white/[0.18]"
                  placeholder="Optional"
                />
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="h-10 rounded-full border border-white/[0.09] bg-transparent px-4 text-[13px] font-medium text-[#b8b8bd] transition duration-200 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="h-10 rounded-full border border-[#d7ff3f] bg-[#d7ff3f] px-5 text-[13px] font-semibold text-[#050505] transition duration-200 disabled:cursor-default disabled:opacity-45"
                >
                  {busy ? "Creating" : "Create"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.main>
  );
}

export default function ProjectsPage() {
  return (
    <AuthGate>
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
