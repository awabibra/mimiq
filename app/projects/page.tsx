"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import WaveSurfer from "wavesurfer.js";
import {
  ArrowRight,
  AudioWaveform,
  Check,
  ChevronDown,
  Clock3,
  FolderOpen,
  Mic2,
  MoreHorizontal,
  Music2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Logo } from "@/components/ui/logo";
import {
  consumeEntryProjectsCache,
  consumeEntryVisualHandoff,
} from "@/lib/entryHandoff";
import { getAuthSession } from "@/lib/auth";
import {
  createProjectRecord,
  deleteProjectRecord,
  listProjects,
  saveProjectPatch,
  touchProject,
} from "@/lib/projects";
import type {
  AudioServiceStatus,
  GeneratedChain,
  Project,
  ProjectAudioAsset,
  WorkflowStage,
} from "@/lib/types";
import {
  getAssetPlaybackUrl,
  getFullSongAsset,
  getPrimaryBeatAsset,
  getPrimaryVocalAsset,
  getPrimaryVocalOrFullSongAsset,
  getProjectAudioAssets,
} from "@/lib/projectAudio";
import { getLatestGeneratedChain, useProject } from "@/lib/useProject";
import { useAudioStore } from "@/lib/useAudioStore";
import {
  defaultGenreCategory,
  defaultGenreSubgenre,
  genreCategories,
  getGenreCategory,
  getGenreSubgenre,
  getSubgenresForCategory,
  type GenreCategoryId,
  type GenreSubgenreId,
} from "@/lib/genreCatalog";
import styles from "./page.module.css";

const STAGES: Array<{
  id: WorkflowStage;
  label: string;
  detail: string;
}> = [
  { id: "setup", label: "Setup", detail: "Inputs & direction" },
  { id: "prepare", label: "Vocal Check", detail: "Performance readiness" },
  { id: "main_chain", label: "Vocal Chain", detail: "Core vocal control" },
  { id: "buses", label: "Buses", detail: "Space & parallel tone" },
  { id: "match_beat", label: "Match to Beat", detail: "Context & translation" },
];

type SortMode = "recent" | "name";

type ProjectDialog =
  | { kind: "create" }
  | { kind: "edit"; project: Project }
  | { kind: "delete"; project: Project }
  | null;

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

function previewAsset(
  projectId: string,
  kind: "vocal" | "beat" | "full_song",
  filename: string
): ProjectAudioAsset {
  return {
    id: `${projectId}-${kind}`,
    kind,
    filename,
    mimeType: "audio/wav",
    size: 0,
    duration: 154,
    storagePath: null,
    createdAt: new Date().toISOString(),
    status: "ready",
    error: null,
  };
}

function previewProject(params: {
  id: string;
  name: string;
  category: GenreCategoryId;
  subgenre: GenreSubgenreId;
  beat: string | null;
  minutesAgo: number;
  assets?: ProjectAudioAsset[];
  analysis?: boolean;
  plan?: boolean;
}): Project {
  const timestamp = new Date(
    Date.now() - params.minutesAgo * 60_000
  ).toISOString();

  return {
    id: params.id,
    user_id: "preview-user",
    name: params.name,
    genre_category: params.category,
    genre_subgenre: params.subgenre,
    created_at: timestamp,
    updated_at: timestamp,
    audio_assets: params.assets ?? [],
    beat_file_url: null,
    beat_filename: params.beat,
    vocal_versions: [],
    current_vocal_index: 0,
    generated_chains: [],
    mix_room_report: null,
    level_lab_report: null,
    stem_split_url: null,
    last_opened_at: timestamp,
    active_analysis_run_id: params.analysis ? `${params.id}-analysis` : null,
    active_mix_plan_id: params.plan ? `${params.id}-plan` : null,
  };
}

const PREVIEW_PROJECTS: Project[] = [
  previewProject({
    id: "preview-no-signal",
    name: "No Signal",
    category: "trap",
    subgenre: "dark_trap",
    beat: "no_signal_142.wav",
    minutesAgo: 18,
    assets: [
      previewAsset("preview-no-signal", "vocal", "lead_vocal.wav"),
      previewAsset("preview-no-signal", "beat", "no_signal_142.wav"),
    ],
    analysis: true,
  }),
  previewProject({
    id: "preview-after-hours",
    name: "After Hours Demo",
    category: "trap",
    subgenre: "hard_trap",
    beat: "after_hours_128.wav",
    minutesAgo: 1320,
    assets: [
      previewAsset("preview-after-hours", "vocal", "lead_vocal.wav"),
      previewAsset("preview-after-hours", "beat", "after_hours_128.wav"),
    ],
    analysis: true,
    plan: true,
  }),
  previewProject({
    id: "preview-northside",
    name: "Northside Take",
    category: "drill",
    subgenre: "uk_melodic_drill",
    beat: "northside_mix.wav",
    minutesAgo: 2940,
    assets: [
      previewAsset("preview-northside", "full_song", "northside_mix.wav"),
    ],
  }),
  previewProject({
    id: "preview-late-nights",
    name: "Late Nights_120bpm",
    category: "trap",
    subgenre: "emo_trap",
    beat: "late_nights_120.wav",
    minutesAgo: 5820,
    assets: [
      previewAsset("preview-late-nights", "vocal", "lead_vocal.wav"),
      previewAsset("preview-late-nights", "beat", "late_nights_120.wav"),
    ],
  }),
  previewProject({
    id: "preview-untitled",
    name: "Untitled Session",
    category: "pop",
    subgenre: "dark_pop",
    beat: null,
    minutesAgo: 15900,
  }),
];

function readTime(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function projectActivityTime(project: Project) {
  return Math.max(
    readTime(project.last_opened_at),
    readTime(project.updated_at),
    readTime(project.created_at)
  );
}

function sortByRecent(projects: Project[]) {
  return [...projects].sort(
    (a, b) => projectActivityTime(b) - projectActivityTime(a)
  );
}

function formatLastOpened(project: Project) {
  const time = projectActivityTime(project);
  if (!time) return "Not opened yet";

  const elapsed = Date.now() - time;
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year:
      new Date(time).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  }).format(new Date(time));
}

function getProjectLane(project: Project) {
  const category = getGenreCategory(project.genre_category);
  const subgenre = getGenreSubgenre(project.genre_subgenre);

  if (subgenre) {
    return {
      category: getGenreCategory(subgenre.category)?.label ?? "Genre",
      subgenre: subgenre.label,
    };
  }

  return {
    category: category?.label ?? "Genre not set",
    subgenre: category ? "Subgenre not set" : "Set a genre",
  };
}

function getInputState(project: Project) {
  const readyAssets = getProjectAudioAssets(project).filter(
    (asset) => asset.status === "ready"
  );

  return {
    hasVocal: readyAssets.some((asset) => asset.kind === "vocal"),
    hasBeat: readyAssets.some((asset) => asset.kind === "beat"),
    hasFullSong: readyAssets.some((asset) => asset.kind === "full_song"),
  };
}

function getWorkflowStage(project: Project): WorkflowStage {
  const input = getInputState(project);

  if (!input.hasVocal) return "setup";
  if (!project.active_analysis_run_id) return "prepare";
  if (!project.active_mix_plan_id) return "main_chain";
  return "buses";
}

function getEvidenceState(project: Project) {
  const latestChain = getLatestGeneratedChain(project);
  const chain = latestChain?.chain_data;
  const level = project.level_lab_report;
  const mix = project.mix_room_report;

  if (
    chain?.audio_service_status === "ok" ||
    level?.audio_service_status === "ok" ||
    mix?.audio_service_status === "ok"
  ) {
    return "Measured";
  }

  if (chain?.fallback_used || level?.fallback_used || mix?.fallback_used) {
    return "Fallback labeled";
  }

  if (latestChain || level || mix) return "Saved project data";
  return "Evidence unknown";
}

function getStageGuidance(stage: WorkflowStage) {
  switch (stage) {
    case "setup":
      return "Add the raw vocal. The beat can wait until Buses.";
    case "prepare":
      return "Run the measured performance and recording check.";
    case "main_chain":
      return "Continue the catalogue-backed main vocal chain.";
    case "buses":
      return "Set space and parallel tone around the saved main chain.";
    case "match_beat":
      return "Compare the processed print against the beat.";
  }
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
      chainData.audio_service_status ??
      SAFE_ANALYSIS_PROVENANCE.audio_service_status,
  };
}

function toAudioSession(project: Project) {
  const latestChain = getLatestGeneratedChain(project);
  const chainData = latestChain?.chain_data;
  const xyPosition = chainData?.xyPosition ?? { x: 0.55, y: 0.62 };
  const provenance = provenanceFromChainData(chainData);

  return {
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
    isAnalyzed: Boolean(chainData?.measurements),
  };
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

function ProjectWave({
  asset,
  height,
  muted = false,
}: {
  asset: ProjectAudioAsset | null;
  height: number;
  muted?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const assetRef = useRef(asset);
  const assetId = asset?.id ?? null;
  const storagePath = asset?.storagePath ?? null;
  const [state, setState] = useState<
    "empty" | "loading" | "ready" | "unavailable"
  >(asset?.storagePath ? "loading" : asset ? "unavailable" : "empty");

  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  useEffect(() => {
    const currentAsset = assetRef.current;
    if (!currentAsset || !containerRef.current) {
      setState("empty");
      return;
    }
    if (!currentAsset.storagePath) {
      setState("unavailable");
      return;
    }

    let alive = true;
    let wave: WaveSurfer | null = null;
    setState("loading");

    async function load() {
      const url = await getAssetPlaybackUrl(currentAsset);
      if (!alive) return;
      if (!url || !containerRef.current) {
        setState("unavailable");
        return;
      }

      wave = WaveSurfer.create({
        container: containerRef.current,
        height,
        waveColor: muted
          ? "rgba(107,107,107,.48)"
          : "rgba(232,232,224,.62)",
        progressColor: muted
          ? "rgba(215,255,63,.22)"
          : "rgba(215,255,63,.42)",
        cursorWidth: 0,
        normalize: true,
        interact: false,
        barWidth: 1,
        barGap: 1,
        barRadius: 1,
      });

      wave.on("ready", () => {
        if (alive) setState("ready");
      });
      wave.on("error", () => {
        if (alive) setState("unavailable");
      });

      await wave.load(url);
    }

    void load().catch((error: unknown) => {
      if (alive && !isAbortError(error)) setState("unavailable");
    });

    return () => {
      alive = false;
      wave?.destroy();
    };
  }, [assetId, height, muted, storagePath]);

  return (
    <div className={styles.waveShell} data-state={state}>
      <div ref={containerRef} className={styles.waveCanvas} />
      {state !== "ready" && (
        <span>
          {state === "loading"
            ? "Loading waveform"
            : state === "unavailable"
              ? "Waveform unavailable"
              : "No audio uploaded"}
        </span>
      )}
    </div>
  );
}

function FeaturedAudio({ project }: { project: Project }) {
  const vocal = getPrimaryVocalAsset(project);
  const beat = getPrimaryBeatAsset(project);
  const fullSong = getFullSongAsset(project);

  if (!vocal && !beat && fullSong) {
    return (
      <div className={styles.featuredWaveforms}>
        <div className={styles.waveLane}>
          <span>Stem Rip source · raw vocal still needed</span>
          <ProjectWave asset={fullSong} height={74} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.featuredWaveforms}>
      <div className={styles.waveLane}>
        <span>Lead vocal</span>
        <ProjectWave asset={vocal} height={42} />
      </div>
      <div className={styles.waveLane}>
        <span>Beat</span>
        <ProjectWave asset={beat} height={42} muted />
      </div>
    </div>
  );
}

function InputStatus({ project, compact = false }: { project: Project; compact?: boolean }) {
  const input = getInputState(project);

  if (input.hasFullSong && !input.hasVocal && !input.hasBeat) {
    return (
      <div className={styles.inputStatus} data-compact={compact}>
        <span data-ready="false" title="Full song is available to Stem Rip">
          <AudioWaveform aria-hidden="true" />
          {!compact && "Raw vocal missing"}
        </span>
        <small>Use Stem Rip or add vocal</small>
      </div>
    );
  }

  return (
    <div className={styles.inputStatus} data-compact={compact}>
      <span data-ready={input.hasVocal} title={input.hasVocal ? "Lead vocal ready" : "Lead vocal missing"}>
        <Mic2 aria-hidden="true" />
        {!compact && (input.hasVocal ? "Vocal ready" : "Vocal missing")}
      </span>
      <span data-ready={input.hasBeat} title={input.hasBeat ? "Beat ready" : "Beat missing"}>
        <Music2 aria-hidden="true" />
        {!compact && (input.hasBeat ? "Beat ready" : "Beat missing")}
      </span>
    </div>
  );
}

function StageRoute({ project }: { project: Project }) {
  const activeStage = getWorkflowStage(project);
  const activeIndex = STAGES.findIndex((stage) => stage.id === activeStage);

  return (
    <div className={styles.stageRoute} aria-label="Saved project workflow">
      {STAGES.map((stage, index) => {
        const complete = index < activeIndex;
        const active = index === activeIndex;
        return (
          <div
            key={stage.id}
            className={styles.stageNode}
            data-complete={complete}
            data-active={active}
          >
            <div className={styles.stageMarker}>
              {complete ? <Check aria-hidden="true" /> : stage.id === "setup" ? 0 : index}
            </div>
            <span>
              <strong>{stage.label}</strong>
              <small>
                {complete
                  ? "Complete"
                  : active
                    ? activeStage === "prepare" &&
                      !getInputState(project).hasFullSong &&
                      !getInputState(project).hasVocal
                      ? "Needs inputs"
                      : "Working"
                    : index === activeIndex + 1
                      ? "Next"
                      : "Not started"}
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProjectsInner({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeProjectId = useProject((state) => state.project?.id ?? null);
  const setActiveProject = useProject((state) => state.setActiveProject);
  const clearActiveProject = useProject((state) => state.clearActiveProject);
  const setPrompt = useProject((state) => state.setPrompt);
  const setSession = useAudioStore((state) => state.setSession);
  const clearSession = useAudioStore((state) => state.clearSession);
  const [initialProjects] = useState(() =>
    preview ? PREVIEW_PROJECTS : consumeEntryProjectsCache()
  );
  const [entryReveal] = useState(() => consumeEntryVisualHandoff());
  const [projects, setProjects] = useState<Project[]>(() => initialProjects ?? []);
  const [loading, setLoading] = useState(() => initialProjects === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ProjectDialog>(null);
  const [formName, setFormName] = useState("");
  const [formBeat, setFormBeat] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<GenreCategoryId>(defaultGenreCategory);
  const [selectedSubgenreId, setSelectedSubgenreId] =
    useState<GenreSubgenreId>(defaultGenreSubgenre);
  const [busy, setBusy] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [accountInitials, setAccountInitials] = useState("M");
  const [exiting, setExiting] = useState(false);
  const resumeHandled = useRef(false);

  const selectedSubgenres = useMemo(
    () => getSubgenresForCategory(selectedCategoryId),
    [selectedCategoryId]
  );

  const featuredProject = useMemo(
    () => sortByRecent(projects)[0] ?? null,
    [projects]
  );

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = projects.filter((project) => {
      if (project.id === featuredProject?.id) return false;
      if (!normalized) return true;

      const lane = getProjectLane(project);
      return [
        project.name,
        lane.category,
        lane.subgenre,
        project.beat_filename ?? "",
      ].some((value) => value.toLowerCase().includes(normalized));
    });

    return sortMode === "name"
      ? filtered.sort((a, b) => a.name.localeCompare(b.name))
      : sortByRecent(filtered);
  }, [featuredProject?.id, projects, query, sortMode]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (preview) {
        setProjects(PREVIEW_PROJECTS);
        setAccountInitials("MQ");
        setLoading(false);
        return;
      }

      try {
        if (initialProjects === null) setLoading(true);
        setLoadError(null);
        const [data, auth] = await Promise.all([
          listProjects(),
          getAuthSession(),
        ]);
        if (!alive) return;
        setProjects(data);

        const email = auth?.user.email ?? "";
        const local = email.split("@")[0] ?? "";
        const initials = local
          .split(/[._-]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase())
          .join("");
        if (initials) setAccountInitials(initials);
      } catch {
        if (alive) {
          setProjects([]);
          setLoadError(
            "Your projects could not be loaded. Check your session and try again."
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [initialProjects, preview, reloadCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (dialog) setDialog(null);
      else setOpenMenuId(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dialog]);

  const openProject = useCallback(
    async (project: Project, requestedStage?: string | null, openHistory = false) => {
      if (busy) return;
      setBusy(true);
      setBusyProjectId(project.id);
      setOpenMenuId(null);

      try {
        const touched = await touchProject(project.id);
        setProjects((current) =>
          current.map((item) => (item.id === touched.id ? touched : item))
        );
        setActiveProject(touched);
        setSession(toAudioSession(touched));
        setPrompt(null);
        setExiting(true);
        const requested =
          requestedStage &&
          STAGES.some((stage) => stage.id === requestedStage)
            ? (requestedStage as WorkflowStage)
            : getWorkflowStage(touched);
        await new Promise((resolve) => setTimeout(resolve, 220));
        router.push(
          `/projects/${touched.id}?stage=${requested}${openHistory ? "&history=1" : ""}`
        );
      } catch {
        setFormError("The project could not be opened. Try again.");
        setBusy(false);
        setBusyProjectId(null);
        setExiting(false);
      }
    },
    [busy, router, setActiveProject, setPrompt, setSession]
  );

  useEffect(() => {
    if (
      resumeHandled.current ||
      searchParams.get("resume") !== "1" ||
      loading ||
      !featuredProject
    ) {
      return;
    }

    resumeHandled.current = true;
    void openProject(
      featuredProject,
      searchParams.get("stage"),
      searchParams.get("history") === "1"
    );
  }, [featuredProject, loading, openProject, searchParams]);

  const selectCategory = useCallback((categoryId: GenreCategoryId) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubgenreId(
      getSubgenresForCategory(categoryId)[0]?.id ?? defaultGenreSubgenre
    );
  }, []);

  const openCreateDialog = useCallback(() => {
    setFormName("");
    setFormBeat("");
    setSelectedCategoryId(defaultGenreCategory);
    setSelectedSubgenreId(defaultGenreSubgenre);
    setFormError(null);
    setOpenMenuId(null);
    setDialog({ kind: "create" });
  }, []);

  const openEditDialog = useCallback((project: Project) => {
    const category =
      getGenreCategory(project.genre_category)?.id ?? defaultGenreCategory;
    const subgenre =
      getGenreSubgenre(project.genre_subgenre)?.id ??
      getSubgenresForCategory(category)[0]?.id ??
      defaultGenreSubgenre;

    setFormName(project.name);
    setFormBeat(project.beat_filename ?? "");
    setSelectedCategoryId(category);
    setSelectedSubgenreId(subgenre);
    setFormError(null);
    setOpenMenuId(null);
    setDialog({ kind: "edit", project });
  }, []);

  const submitProject = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!dialog || dialog.kind === "delete" || busy || !formName.trim()) return;

      setBusy(true);
      setFormError(null);

      try {
        if (dialog.kind === "create") {
          const auth = await getAuthSession();
          if (!auth) {
            router.replace("/auth?mode=signin&next=%2Fprojects");
            return;
          }

          let project = await createProjectRecord(formName.trim(), auth.user.id, {
            genre_category: selectedCategoryId,
            genre_subgenre: selectedSubgenreId,
          });

          if (formBeat.trim()) {
            project = await saveProjectPatch(project.id, {
              beat_filename: formBeat.trim(),
            });
          }

          setProjects((current) => [project, ...current]);
          setActiveProject(project);
          clearSession();
          setPrompt(null);
          setDialog(null);
          setExiting(true);
          await new Promise((resolve) => setTimeout(resolve, 220));
          router.push(`/projects/${project.id}?stage=prepare`);
          return;
        }

        const updated = await saveProjectPatch(dialog.project.id, {
          name: formName.trim(),
          genre_category: selectedCategoryId,
          genre_subgenre: selectedSubgenreId,
        });
        setProjects((current) =>
          current.map((project) =>
            project.id === updated.id ? updated : project
          )
        );
        if (activeProjectId === updated.id) setActiveProject(updated);
        setDialog(null);
      } catch {
        setFormError(
          dialog.kind === "create"
            ? "The project could not be created. Try again."
            : "The project changes could not be saved. Try again."
        );
      } finally {
        setBusy(false);
      }
    },
    [
      activeProjectId,
      busy,
      clearSession,
      dialog,
      formBeat,
      formName,
      router,
      selectedCategoryId,
      selectedSubgenreId,
      setActiveProject,
      setPrompt,
    ]
  );

  const confirmDelete = useCallback(async () => {
    if (!dialog || dialog.kind !== "delete" || busy) return;

    const project = dialog.project;
    setBusy(true);
    setBusyProjectId(project.id);
    setFormError(null);

    try {
      await deleteProjectRecord(project);
      setProjects((current) =>
        current.filter((item) => item.id !== project.id)
      );
      if (activeProjectId === project.id) {
        clearActiveProject();
        clearSession();
      }
      setDialog(null);
    } catch {
      setFormError("The project could not be deleted. Try again.");
    } finally {
      setBusy(false);
      setBusyProjectId(null);
    }
  }, [
    activeProjectId,
    busy,
    clearActiveProject,
    clearSession,
    dialog,
  ]);

  const toggleMenu = (
    event: MouseEvent<HTMLButtonElement>,
    projectId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setOpenMenuId(openMenuId === projectId ? null : projectId);
  };

  const stopClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const renderProjectMenu = (project: Project) => (
    <AnimatePresence>
      {openMenuId === project.id && (
        <motion.div
          className={styles.projectMenu}
          role="menu"
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.16 }}
          onClick={stopClick}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => openEditDialog(project)}
          >
            <Pencil aria-hidden="true" />
            <span>
              <strong>Edit project</strong>
              <small>Edit name and genre</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.deleteMenuItem}
            onClick={() => {
              setOpenMenuId(null);
              setFormError(null);
              setDialog({ kind: "delete", project });
            }}
          >
            <Trash2 aria-hidden="true" />
            <span>
              <strong>Delete project</strong>
              <small>Remove this project</small>
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <motion.main
      className={styles.shell}
      animate={exiting ? { opacity: 0, y: -14 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      {entryReveal && (
        <motion.div
          className={styles.entryVeil}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ delay: 0.04, duration: 0.8 }}
        />
      )}

      <motion.header
        className={styles.topBar}
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42 }}
      >
        <div className={styles.brandBlock}>
          <Logo className={styles.logo} />
          <span className={styles.brandDivider} />
          <h1>Projects</h1>
        </div>

        <div className={styles.headerActions}>
          <label className={styles.searchBox}>
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
            />
          </label>

          <label className={styles.sortControl}>
            <SlidersHorizontal aria-hidden="true" />
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              aria-label="Sort projects"
            >
              <option value="recent">Last opened</option>
              <option value="name">Project name</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </label>

          <motion.button
            type="button"
            className={styles.newProjectButton}
            onClick={(event) => {
              event.stopPropagation();
              openCreateDialog();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            <Plus aria-hidden="true" />
            New project
          </motion.button>

          <button
            type="button"
            className={styles.accountButton}
            aria-label="Account"
          >
            {accountInitials}
          </button>
        </div>
      </motion.header>

      <section className={styles.workspace}>
        {loading && (
          <div className={styles.loadingState} aria-label="Loading projects">
            <div className={styles.loadingFeatured} />
            <div className={styles.loadingRow} />
            <div className={styles.loadingRow} />
            <div className={styles.loadingRow} />
          </div>
        )}

        {!loading && loadError && (
          <motion.div
            className={styles.emptyState}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
          >
            <AudioWaveform aria-hidden="true" />
            <h2>Projects unavailable</h2>
            <p>{loadError}</p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setReloadCount((count) => count + 1)}
            >
              Try again
            </button>
          </motion.div>
        )}

        {!loading && !loadError && !featuredProject && (
          <motion.div
            className={styles.emptyState}
            initial={false}
            animate={{ opacity: 1, y: 0 }}
          >
            <AudioWaveform aria-hidden="true" />
            <h2>No projects yet</h2>
            <p>Create a project to begin preparing your vocal and beat.</p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={openCreateDialog}
            >
              <Plus aria-hidden="true" />
              New project
            </button>
          </motion.div>
        )}

        {!loading && !loadError && featuredProject && (
          <>
            <motion.section
              className={styles.featuredSection}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.42 }}
            >
              <h2>Last opened</h2>
              <div className={styles.featuredProject}>
                <div className={styles.featuredIdentity}>
                  <h3>{featuredProject.name}</h3>
                  <p>
                    {getProjectLane(featuredProject).subgenre}
                    <span>·</span>
                    {featuredProject.beat_filename || "No beat name"}
                  </p>
                  <div className={styles.lastOpened}>
                    <Clock3 aria-hidden="true" />
                    Last opened
                    <strong>{formatLastOpened(featuredProject)}</strong>
                  </div>
                  <InputStatus project={featuredProject} />
                </div>

                <FeaturedAudio project={featuredProject} />
                <StageRoute project={featuredProject} />

                <div className={styles.featuredActions}>
                  <motion.button
                    type="button"
                    className={styles.resumeButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      void openProject(featuredProject);
                    }}
                    disabled={busy}
                    whileHover={{ scale: busy ? 1 : 1.02 }}
                    whileTap={{ scale: busy ? 1 : 0.97 }}
                  >
                    {busyProjectId === featuredProject.id
                      ? "Opening"
                      : "Resume project"}
                    <ArrowRight aria-hidden="true" />
                  </motion.button>
                  <button
                    type="button"
                    className={styles.menuButton}
                    aria-label={`Actions for ${featuredProject.name}`}
                    aria-expanded={openMenuId === featuredProject.id}
                    onClick={(event) => toggleMenu(event, featuredProject.id)}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </button>
                  {renderProjectMenu(featuredProject)}
                </div>
              </div>

              <button
                type="button"
                className={styles.nextAction}
                onClick={() => void openProject(featuredProject)}
                disabled={busy}
              >
                <AudioWaveform aria-hidden="true" />
                <span>
                  <strong>Next:</strong>
                  {getStageGuidance(getWorkflowStage(featuredProject))}
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            </motion.section>

            <motion.section
              className={styles.allProjectsSection}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.42 }}
            >
              <div className={styles.sectionHeading}>
                <h2>All projects</h2>
                <span>
                  {visibleProjects.length}{" "}
                  {visibleProjects.length === 1 ? "project" : "projects"}
                </span>
              </div>

              {visibleProjects.length > 0 ? (
                <div className={styles.projectList}>
                  {visibleProjects.map((project, index) => {
                    const stage = getWorkflowStage(project);
                    const stageInfo =
                      STAGES.find((item) => item.id === stage) ?? STAGES[0];
                    const rowAsset =
                      getPrimaryVocalOrFullSongAsset(project) ??
                      getPrimaryBeatAsset(project);

                    return (
                      <motion.article
                        key={project.id}
                        className={styles.projectRow}
                        initial={false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.18 + index * 0.045 }}
                      >
                        <button
                          type="button"
                          className={styles.rowOpenTarget}
                          aria-label={`Open ${project.name}`}
                          onClick={() => void openProject(project)}
                          disabled={busy}
                        />

                        <div className={styles.openProjectIcon}>
                          <FolderOpen aria-hidden="true" />
                        </div>

                        <div className={styles.rowIdentity}>
                          <h3>{project.name}</h3>
                          <p>
                            {getProjectLane(project).subgenre}
                            <span>·</span>
                            {project.beat_filename || "No beat name"}
                          </p>
                        </div>

                        <div className={styles.rowWave}>
                          <ProjectWave asset={rowAsset} height={46} muted />
                        </div>

                        <InputStatus project={project} compact />

                        <div className={styles.rowStage}>
                          <span>{stageInfo.label}</span>
                          <small>{getEvidenceState(project)}</small>
                        </div>

                        <time className={styles.rowDate}>
                          <span>Last opened</span>
                          {formatLastOpened(project)}
                        </time>

                        <div className={styles.rowMenuAnchor}>
                          <button
                            type="button"
                            className={styles.menuButton}
                            aria-label={`Actions for ${project.name}`}
                            aria-expanded={openMenuId === project.id}
                            onClick={(event) =>
                              toggleMenu(event, project.id)
                            }
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                          {renderProjectMenu(project)}
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.noMatches}>
                  <Search aria-hidden="true" />
                  <span>
                    {query
                      ? `No other projects match “${query}”.`
                      : "Create another project when you are ready to start a new song."}
                  </span>
                  {!query && (
                    <button type="button" onClick={openCreateDialog}>
                      New project
                    </button>
                  )}
                </div>
              )}
            </motion.section>
          </>
        )}
      </section>

      <AnimatePresence>
        {dialog && (
          <motion.div
            className={styles.modalBackdrop}
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => {
              if (!busy) setDialog(null);
            }}
          >
            {dialog.kind === "delete" ? (
              <motion.section
                className={`${styles.modalCard} ${styles.deleteDialog}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-project-title"
                initial={false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                onMouseDown={stopClick}
              >
                <div className={styles.deleteIcon}>
                  <Trash2 aria-hidden="true" />
                </div>
                <div className={styles.modalHeader}>
                  <h2 id="delete-project-title">Delete project?</h2>
                  <p>
                    “{dialog.project.name}” and its known uploaded project files
                    will be removed. This cannot be undone.
                  </p>
                </div>
                {formError && <p className={styles.formError}>{formError}</p>}
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setDialog(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => void confirmDelete()}
                    disabled={busy}
                  >
                    {busyProjectId === dialog.project.id
                      ? "Deleting"
                      : "Delete project"}
                  </button>
                </div>
              </motion.section>
            ) : (
              <motion.form
                className={styles.modalCard}
                onSubmit={submitProject}
                initial={false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                onMouseDown={stopClick}
              >
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => setDialog(null)}
                  disabled={busy}
                  aria-label="Close dialog"
                >
                  <X aria-hidden="true" />
                </button>

                <div className={styles.modalHeader}>
                  <h2>
                    {dialog.kind === "create"
                      ? "New project"
                      : "Edit project"}
                  </h2>
                  <p>
                    {dialog.kind === "create"
                      ? "Create one project window for this song."
                      : "Update the project name and genre lane."}
                  </p>
                </div>

                <label className={styles.fieldLabel}>
                  Project name
                  <input
                    value={formName}
                    onChange={(event) => setFormName(event.target.value)}
                    autoFocus
                    required
                    maxLength={80}
                    placeholder="Midnight demo"
                  />
                </label>

                {dialog.kind === "create" && (
                  <label className={styles.fieldLabel}>
                    Beat name
                    <input
                      value={formBeat}
                      onChange={(event) => setFormBeat(event.target.value)}
                      maxLength={100}
                      placeholder="Optional"
                    />
                  </label>
                )}

                <fieldset className={styles.genreFieldset}>
                  <legend>Genre category</legend>
                  <div className={styles.categoryGrid}>
                    {genreCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={
                          selectedCategoryId === category.id
                            ? styles.genreButtonActive
                            : styles.genreButton
                        }
                        onClick={() => selectCategory(category.id)}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className={styles.genreFieldset}>
                  <legend>Subgenre</legend>
                  <div className={styles.subgenreGrid}>
                    {selectedSubgenres.map((subgenre) => (
                      <button
                        key={subgenre.id}
                        type="button"
                        className={
                          selectedSubgenreId === subgenre.id
                            ? styles.genreButtonActive
                            : styles.genreButton
                        }
                        onClick={() => setSelectedSubgenreId(subgenre.id)}
                      >
                        {subgenre.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {formError && <p className={styles.formError}>{formError}</p>}

                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setDialog(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={busy || !formName.trim()}
                  >
                    {busy
                      ? dialog.kind === "create"
                        ? "Creating"
                        : "Saving"
                      : dialog.kind === "create"
                        ? "Create project"
                        : "Save changes"}
                  </button>
                </div>
              </motion.form>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.main>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={<div className={styles.pageFallback}>Loading projects</div>}
    >
      <ProjectsGate />
    </Suspense>
  );
}

function ProjectsGate() {
  const searchParams = useSearchParams();
  const preview =
    process.env.NODE_ENV === "development" &&
    searchParams.get("preview") === "1";

  if (preview) return <ProjectsInner preview />;

  return (
    <AuthGate allowEntryHandoff>
      <ProjectsInner />
    </AuthGate>
  );
}
