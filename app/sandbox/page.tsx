"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

import { eras, defaultEra, type Era } from "@/lib/eras";
import type {
  AudioMetrics,
  ChainStep,
  AnalysisResponse,
  AnalysisError,
} from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { AnimatedGrid } from "@/components/AnimatedGrid";
import { useStore } from "@/lib/store";
import { useAudioStore } from "@/lib/useAudioStore";
import { VisualVocalChain } from "./VisualVocalChain";
import styles from "./page.module.css";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

type AppState = "empty" | "analyzing" | "results";

interface AudioInsights {
  loudness: string;
  dynamicRange: string;
  brightness: string;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

/* ═══════════════════════════════════════════════════════════════
   Analysis steps labels (cosmetic — fill the wait)
   ═══════════════════════════════════════════════════════════════ */

const ANALYSIS_STEPS = [
  "Reading loudness levels...",
  "Measuring dynamic range...",
  "Checking frequency balance...",
  "Mapping vocal character...",
];

/* ═══════════════════════════════════════════════════════════════
   Inline SVG icons
   ═══════════════════════════════════════════════════════════════ */

function UploadArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5,12 12,5 19,12" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3,8 7,12 13,4" />
    </svg>
  );
}



/* ═══════════════════════════════════════════════════════════════
   API helper
   ═══════════════════════════════════════════════════════════════ */

async function callAnalyze(params: {
  vocalFile?: File;
  beatFile?: File | null;
  daw: string;
  mic?: string | null;
  plugins?: string[];
  eraId: string;
  xyX?: number;
  xyY?: number;
  cachedMetrics?: AudioMetrics;
}): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append("daw", params.daw);
  form.append("era", params.eraId);

  if (params.vocalFile) form.append("vocalFile", params.vocalFile);
  if (params.beatFile) form.append("beatFile", params.beatFile);
  if (params.xyX != null) form.append("xyX", String(params.xyX));
  if (params.xyY != null) form.append("xyY", String(params.xyY));
  if (params.cachedMetrics)
    form.append("cachedMetrics", JSON.stringify(params.cachedMetrics));

  const res = await fetch("/api/analyze", { method: "POST", body: form });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as AnalysisError;
    throw body;
  }

  return (await res.json()) as AnalysisResponse;
}

/* ═══════════════════════════════════════════════════════════════
   Format helpers
   ═══════════════════════════════════════════════════════════════ */

function formatInsights(m: AudioMetrics): AudioInsights {
  return {
    loudness: `${m.lufs.toFixed(1)} LUFS`,
    dynamicRange: `${m.dynamicRange.toFixed(1)} dB`,
    brightness: `${m.spectralCentroid.toFixed(1)} kHz`,
  };
}

/* ═══════════════════════════════════════════════════════════════
   Transition Overlay Component
   ═══════════════════════════════════════════════════════════════ */

function SandboxTransitionOverlay() {
  return (
    <div className={styles.cinematicOverlay}>
      <div className={styles.cinematicContent}>
        <div className={styles.cinematicTextContainer}>
          <span className={styles.cinematicTextMain}>
            creat
            <span className={styles.cinematicLetterE}>e</span>
            <span className={styles.cinematicLetterIng}>ing</span>
            {" what you thought isnt possible"}
          </span>
          <span className={styles.cinematicTextDot}>.</span>
        </div>
        <div className={styles.cinematicLoadingBarContainer}>
          <div className={styles.cinematicLoadingBarFill} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Animated Border Component
   ═══════════════════════════════════════════════════════════════ */

function AnimatedDashedBorder() {
  return (
    <svg className={styles.dashedSvg} xmlns="http://www.w3.org/2000/svg">
      <rect className={styles.dashedRect1} x="0" y="0" width="100%" height="100%" rx="12" />
      <rect className={styles.dashedRect2} x="0" y="0" width="100%" height="100%" rx="12" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Page component
   ═══════════════════════════════════════════════════════════════ */

export default function SandboxPage() {
  /* Zustand Store */
  const { daw, mic, plugins, era: storeEra, setEra } = useStore();
  const setSession = useAudioStore((state) => state.setSession);

  /* Core state */
  const [appState, setAppState] = useState<AppState>("empty");
  const [activeEra, setActiveEra] = useState<Era>(
    () => eras.find((e) => e.id === storeEra) || defaultEra
  );

  /* Sync activeEra when Zustand hydrates from localStorage */
  useEffect(() => {
    if (storeEra) {
      const era = eras.find((e) => e.id === storeEra);
      if (era && era.id !== activeEra.id) {
        setActiveEra(era);
      }
    }
  }, [storeEra, activeEra.id]);

  const [vocalFile, setVocalFile] = useState<File | null>(null);
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);

  /* Cinematic intro: only shown when arriving from onboarding */
  const [showCinematic, setShowCinematic] = useState(false);
  useEffect(() => {
    const fromOnboarding = sessionStorage.getItem("mimiq-from-onboarding");
    if (fromOnboarding) {
      sessionStorage.removeItem("mimiq-from-onboarding"); // consume — fires once only
      setShowCinematic(true);
    }
  }, []);

  /* Hydration guard to prevent FOUC of the default era */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  /* Real data from API */
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [summary, setSummary] = useState("");
  const [insights, setInsights] = useState<AudioInsights | null>(null);
  const [cachedMetrics, setCachedMetrics] = useState<AudioMetrics | null>(null);

  /* Error states */
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  /* Save chain */
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  /* XY cursor position (normalised 0-1) */
  const [cursorX, setCursorX] = useState(0.55);
  const [cursorY, setCursorY] = useState(0.62);

  /* The position that is currently applied to the generated chain */
  const [appliedX, setAppliedX] = useState(0.55);
  const [appliedY, setAppliedY] = useState(0.62);

  const vocalInputRef = useRef<HTMLInputElement>(null);
  const beatInputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Era switching updates CSS variable ── */
  useIsomorphicLayoutEffect(() => {
    document.documentElement.style.setProperty("--accent", activeEra.accent);
  }, [activeEra]);

  /* ── Auto-dismiss error banner after 8s ── */
  const showBanner = useCallback((msg: string) => {
    setErrorBanner(msg);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setErrorBanner(null), 8000);
  }, []);

  /* ── Handle era change ── */
  const handleEraChange = useCallback(
    async (era: Era) => {
      setActiveEra(era);
      setEra(era.id); // Persist user's manual era choice
      if (appState === "results" && cachedMetrics) {
        setChainLoading(true);
        try {
          const result = await callAnalyze({
            daw: daw || "Logic Pro",
            mic,
            plugins,
            eraId: era.id,
            xyX: cursorX,
            xyY: cursorY,
            cachedMetrics,
          });
          setChain(result.chain);
          setSummary(result.summary);
        } catch {
          showBanner("Failed to regenerate chain. Try again.");
        } finally {
          setChainLoading(false);
        }
      }
    },
    [appState, cachedMetrics, cursorX, cursorY, showBanner, daw, mic, plugins]
  );

  /* ── Save chain ── */
  const handleSaveChain = useCallback(async () => {
    if (saveStatus !== 'idle' || chain.length === 0) return;
    setSaveStatus('saving');
    try {
      await fetch('/api/chains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'demo-user-001',
          era: activeEra.id,
          daw: daw || 'Logic Pro',
          mic,
          plugins,
          xyPosition: { x: cursorX, y: cursorY },
          chain,
          summary,
          measurements: cachedMetrics ?? {},
          createdAt: new Date().toISOString(),
        }),
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  }, [saveStatus, chain, activeEra.id, cursorX, cursorY, summary, cachedMetrics, daw, mic, plugins]);

  /* ── File handling ── */
  const handleVocalSelect = useCallback(
    async (file: File) => {
      /* Client-side size check */
      if (file.size > MAX_FILE_SIZE) {
        setUploadError("File exceeds 20 MB limit. Try a shorter clip.");
        return;
      }
      setUploadError(null);
      setVocalFile(file);
      setAppState("analyzing");
      const MIN_ANALYZE_MS = 2600;
      const minDelay = new Promise<void>((resolve) =>
        setTimeout(resolve, MIN_ANALYZE_MS)
      );

      try {
        const [result] = await Promise.all([
          callAnalyze({
            vocalFile: file,
            beatFile,
            daw: daw || "Logic Pro",
            mic,
            plugins,
            eraId: activeEra.id,
          }),
          minDelay,
        ]);

        setChain(result.chain);
        setSummary(result.summary);
        setInsights(formatInsights(result.metrics));
        setCachedMetrics(result.metrics);
        setCursorX(result.xyPosition.x);
        setCursorY(result.xyPosition.y);
        setAppliedX(result.xyPosition.x);
        setAppliedY(result.xyPosition.y);
        
        setSession({
          isAnalyzed: true,
          vocalFileUrl: file ? URL.createObjectURL(file) : null,
          beatFileUrl: beatFile ? URL.createObjectURL(beatFile) : null,
          analysisResult: result,
        });

        setAppState("results");
      } catch (err: unknown) {
        await minDelay;
        const apiErr = err as AnalysisError;
        if (apiErr?.error === "audio_service_unavailable") {
          showBanner(
            "Analysis unavailable right now. You can still explore the XY pad for general guidance."
          );
          setAppState("results");
        } else {
          showBanner(
            apiErr?.message || "Something went wrong during analysis."
          );
          setAppState("empty");
          setVocalFile(null);
        }
      }
    },
    [beatFile, activeEra.id, showBanner, daw, mic, plugins]
  );

  const handleVocalInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleVocalSelect(file);
    },
    [handleVocalSelect]
  );

  const handleBeatInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setUploadError("Beat file exceeds 20 MB limit.");
        return;
      }
      setUploadError(null);
      setBeatFile(file);
    }
  }, []);

  /* ── Drag and drop ── */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleVocalSelect(file);
    },
    [handleVocalSelect]
  );

  /* ── Skip upload — explore without audio ── */
  const handleSkip = useCallback(async () => {
    setAppState("analyzing");
    // Minimum display time so the analyzing state reads properly
    const MIN_ANALYZE_MS = 2600;
    const minDelay = new Promise<void>((resolve) =>
      setTimeout(resolve, MIN_ANALYZE_MS)
    );
    try {
      const dummyMetrics = {
        lufs: -14.2,
        dynamicRange: 7.5,
        spectralCentroid: 2.8,
        lowEndEnergy: 0.35,
        stereoWidth: 0.15,
        reverbEstimate: 0.1,
      };

      const [result] = await Promise.all([
        callAnalyze({
          daw: daw || "Logic Pro",
          mic,
          plugins,
          eraId: activeEra.id,
          xyX: 0.55,
          xyY: 0.62,
          cachedMetrics: dummyMetrics,
        }),
        minDelay,
      ]);

      setChain(result.chain);
      setSummary(result.summary);
      setInsights(formatInsights(result.metrics));
      setCachedMetrics(result.metrics);
      setCursorX(result.xyPosition.x);
      setCursorY(result.xyPosition.y);
      setAppliedX(result.xyPosition.x);
      setAppliedY(result.xyPosition.y);
      
      setSession({
        isAnalyzed: true,
        vocalFileUrl: null,
        beatFileUrl: null,
        analysisResult: result,
      });

      setAppState("results");
    } catch {
      // Wait out the minimum time even on error
      await minDelay;
      setAppState("results");
    }
  }, [activeEra.id, daw, mic, plugins]);

  /* ── Remove file ── */
  const handleRemoveVocal = useCallback(() => {
    setVocalFile(null);
    setBeatFile(null);
    setChain([]);
    setSummary("");
    setInsights(null);
    setCachedMetrics(null);
    setErrorBanner(null);
    setUploadError(null);
    setAppState("empty");
  }, []);

  /* ── XY pad drag ── */
  const isDragging = useRef(false);

  /* Debounced API Trigger (REMOVED) */

  /* ── Generate Chain ── */
  const handleGenerate = useCallback(async () => {
    if (!cachedMetrics) return;
    setChainLoading(true);
    try {
      const result = await callAnalyze({
        daw: daw || "Logic Pro",
        mic,
        plugins,
        eraId: activeEra.id,
        xyX: cursorX,
        xyY: cursorY,
        cachedMetrics,
      });
      setChain(result.chain);
      setSummary(result.summary);
      setAppliedX(cursorX);
      setAppliedY(cursorY);
    } catch {
      showBanner("Failed to generate chain. Try again.");
    } finally {
      setChainLoading(false);
    }
  }, [cachedMetrics, activeEra.id, daw, mic, plugins, cursorX, cursorY, showBanner]);

  const updateCursorFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const newX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newY = Math.max(
        0,
        Math.min(1, 1 - (clientY - rect.top) / rect.height)
      );
      setCursorX(newX);
      setCursorY(newY);
    },
    []
  );

  const handleSliderX = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newX = parseFloat(e.target.value);
    setCursorX(newX);
  }, []);

  const handleSliderY = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newY = parseFloat(e.target.value);
    setCursorY(newY);
  }, []);

  const handlePadPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updateCursorFromPointer(e.clientX, e.clientY);
    },
    [updateCursorFromPointer]
  );

  const handlePadPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      updateCursorFromPointer(e.clientX, e.clientY);
    },
    [updateCursorFromPointer]
  );

  const handlePadPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  /* ═══════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════ */

  if (!mounted) return null;

  return (
    <div className={styles.layout}>
      {/* ─────────────────────────────────────────────────
          ENTRANCE OVERLAY — only from onboarding
          ───────────────────────────────────────────────── */}
      {showCinematic && <SandboxTransitionOverlay />}

      {/* ─────────────────────────────────────────────────
          ERROR BANNER
          ───────────────────────────────────────────────── */}
      {errorBanner && (
        <div className={styles.errorBanner}>
          <span className={styles.errorBannerText}>{errorBanner}</span>
          <button
            className={styles.errorBannerDismiss}
            onClick={() => setErrorBanner(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────
          SIDEBAR & MAIN CONTENT
          ───────────────────────────────────────────────── */}
      <Sidebar
        activePage="sandbox"
        activeEra={activeEra}
        onEraChange={handleEraChange}
        savedCount={0}
      />

      <div className={styles.sandboxContent}>
        {/* ─────────────────────────────────────────────────
            CENTER PANEL
            ───────────────────────────────────────────────── */}


      {/* ─────────────────────────────────────────────────
          CENTER PANEL
          ───────────────────────────────────────────────── */}
      <main className={styles.center}>
        {/* File chip — shows uploaded file name */}
        {vocalFile && appState !== "empty" && (
          <div className={styles.fileChip}>
            <span className={styles.fileChipName}>{vocalFile.name}</span>
            <button
              className={styles.fileChipRemove}
              onClick={handleRemoveVocal}
              aria-label="Remove vocal"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {appState === "empty" && (
          <>
            <div
              className={`${styles.uploadZone} ${
                dragOver ? styles.uploadZoneDragover : ""
              }`}
              onClick={() => vocalInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Upload vocal file"
            >
              <AnimatedDashedBorder />
              <UploadArrowIcon className={styles.uploadIcon} />
              <span className={styles.uploadPrimary}>
                Drop your vocal here
              </span>
              <span className={styles.uploadSecondary}>
                .wav or .mp3 · up to 60 seconds
              </span>
              {uploadError && (
                <span className={styles.uploadErrorInline}>{uploadError}</span>
              )}
            </div>
            <input
              ref={vocalInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className={styles.hiddenInput}
              onChange={handleVocalInput}
            />

            <div
              className={styles.beatUpload}
              onClick={() => beatInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload beat file (optional)"
            >
              <AnimatedDashedBorder />
              <UploadArrowIcon className={styles.uploadIcon} />
              <span className={styles.beatUploadText}>
                {beatFile
                  ? `Beat: ${beatFile.name}`
                  : "Add your beat too (optional)"}
              </span>
            </div>
            <input
              ref={beatInputRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className={styles.hiddenInput}
              onChange={handleBeatInput}
            />

            <button className={styles.skipLink} onClick={handleSkip}>
              Skip upload — explore without audio
            </button>
          </>
        )}

        {/* ── Analyzing state ── */}
        {appState === "analyzing" && (
          <div className={styles.analysisCard}>
            {ANALYSIS_STEPS.map((step, i) => (
              <div key={i} className={styles.analysisRow}>
                <span className={styles.analysisText}>{step}</span>
                <CheckIcon className={styles.analysisCheck} />
              </div>
            ))}
          </div>
        )}

        {/* ── Results state ── */}
        {appState === "results" && (
          <>
            {/* XY Pad and Sliders Container */}
            <div className={styles.xyContainer}>
              {/* Top horizontal slider */}
              <div className={styles.sliderTopWrapper}>
                <input 
                  type="range" 
                  min="0" max="1" step="0.01" 
                  value={cursorX} 
                  onChange={handleSliderX} 
                  className={styles.sleekSlider} 
                />
              </div>
              
              <div className={styles.xyMiddleRow}>
                {/* Left vertical slider */}
                <div className={styles.sliderLeftWrapper}>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01" 
                    value={cursorY} 
                    onChange={handleSliderY} 
                    className={`${styles.sleekSlider} ${styles.sliderVertical}`} 
                  />
                </div>

                {/* XY Pad */}
                <div
                  ref={padRef}
                  className={styles.xyPad}
                  onPointerDown={handlePadPointerDown}
                  onPointerMove={handlePadPointerMove}
                  onPointerUp={handlePadPointerUp}
                >
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisTop}`}>
                Bright
              </span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisBottom}`}>
                Dark
              </span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisLeft}`}>
                Dry
              </span>
              <span className={`${styles.xyAxisLabel} ${styles.xyAxisRight}`}>
                Wet
              </span>

              <AnimatedGrid cursorX={cursorX} cursorY={cursorY} />

              <div
                className={styles.xyCursor}
                style={{
                  left: `${cursorX * 100}%`,
                  top: `${(1 - cursorY) * 100}%`,
                }}
              />
            </div>
            </div>
            </div>
            
            {/* Insight strip */}
            <div className={styles.insightStrip}>
              <div className={styles.insightCard}>
                <span className={styles.insightLabel}>Loudness</span>
                <span className={styles.insightValue}>
                  {insights?.loudness ?? "—"}
                </span>
              </div>
              <div className={styles.insightCard}>
                <span className={styles.insightLabel}>Dynamic Range</span>
                <span className={styles.insightValue}>
                  {insights?.dynamicRange ?? "—"}
                </span>
              </div>
              <div className={styles.insightCard}>
                <span className={styles.insightLabel}>Brightness</span>
                <span className={styles.insightValue}>
                  {insights?.brightness ?? "—"}
                </span>
              </div>
            </div>

            {/* Generate Button */}
            <div className={`${styles.generateWrapper} ${Math.abs(cursorX - appliedX) > 0.001 || Math.abs(cursorY - appliedY) > 0.001 ? styles.generateWrapperVisible : ''}`}>
              <button 
                className={`${styles.generateButton} ${chainLoading ? styles.generateButtonLoading : ''}`}
                onClick={handleGenerate}
                disabled={chainLoading}
              >
                {chainLoading ? (
                  <>
                    <div className={styles.analysisSpinner} style={{ width: '12px', height: '12px' }} />
                    Generating...
                  </>
                ) : (
                  "Generate Chain"
                )}
              </button>
            </div>
          </>
        )}
        </main>

      {/* ─────────────────────────────────────────────────
          RIGHT PANEL
          ───────────────────────────────────────────────── */}
      <aside className={styles.right}>
        {/* ── Empty / exploring state ── */}
        {(appState === "empty" || appState === "analyzing") && (
          <div className={styles.rightEmpty}>
            <span className={styles.rightEmptyTitle}>
              Your chain will appear here
            </span>
            <span className={styles.rightEmptyDesc}>
              Upload a vocal to get a personalized chain, or explore the XY pad
              for general guidance.
            </span>
          </div>
        )}

        {/* ── Skeleton loading ── */}
        {appState === "results" && chainLoading && (
          <>
            <div className={styles.chainHeader}>
              <span className={styles.chainTitle}>Vocal Chain</span>
              <span className={styles.eraBadge}>{activeEra.name}</span>
            </div>
            <div className={styles.skeleton}>
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
            </div>
          </>
        )}

        {/* ── Results chain ── */}
        {appState === "results" && !chainLoading && (
          <>
            <div className={styles.chainHeader}>
              <span className={styles.chainTitle}>Vocal Chain</span>
              <span className={styles.eraBadge}>{activeEra.name}</span>
            </div>

            {chain.length === 0 && (
              <div className={styles.rightEmpty}>
                <span className={styles.rightEmptyDesc}>
                  Drag the XY cursor or upload audio to generate a chain.
                </span>
              </div>
            )}
          </>
        )}
      </aside>

      {/* ─────────────────────────────────────────────────
          VISUAL VOCAL CHAIN OVERLAY
          ───────────────────────────────────────────────── */}
      {appState === "results" && !chainLoading && chain.length > 0 && (
        <div className={styles.chainOverlay}>
          <VisualVocalChain chain={chain} />
        </div>
      )}

      </div>

      {/* ─────────────────────────────────────────────────
          MOBILE BOTTOM TAB BAR
          ───────────────────────────────────────────────── */}
      <MobileTabBar activePage="sandbox" />
    </div>
  );
}
