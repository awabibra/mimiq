import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AudioMetrics,
  AudioServiceStatus,
  ChainStep,
  XYPosition,
} from "@/lib/types";
import {
  GENRE_PROFILES,
  getGenreName,
  type GenreName,
  type GenreProfile,
} from "@/lib/chainKnowledge";
import {
  assetResolutionResponse,
  resolveProjectAssetFile,
} from "@/lib/serverProjectAudio";

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 4000;

type FastAPIMetrics = Record<string, unknown>;

interface FastAPIAnalyzeResponse {
  vocal?: FastAPIMetrics | null;
  beat?: FastAPIMetrics | null;
  frequency_collisions?: FastAPIMetrics[];
}

interface AudioAnalysisResult {
  metrics: AudioMetrics;
  fallback_used: boolean;
  audio_service_status: AudioServiceStatus;
}

interface CachedMetricsPayload extends Partial<AudioMetrics> {
  analysis_version?: unknown;
  fallback_used?: unknown;
  audio_service_status?: unknown;
}

/* ═══════════════════════════════════════════════════════════════
   Claude client — lazy singleton
   ═══════════════════════════════════════════════════════════════ */

let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

/* ═══════════════════════════════════════════════════════════════
   Prompt builder
   ═══════════════════════════════════════════════════════════════ */

const DAW_PLUGINS = {
  "Logic Pro": {
    gate: "Noise Gate",
    highpass: "Channel EQ",
    subtractive_eq: "Channel EQ",
    compressor_primary: "Vintage VCA",
    compressor_secondary: "Vintage Opto",
    additive_eq: "Channel EQ",
    deesser: "DeEsser 2",
    saturation: "Tape Delay",
    reverb_bus_reverb: "ChromaVerb",
    reverb_bus_comp: "Compressor",
    delay_bus: "Stereo Delay",
    parallel_comp_bus: "Vintage VCA",
    width_bus: "Chorus",
    saturation_bus: "Bitcrusher",
    mastering_bus_comp: "Vintage VCA",
    mastering_limiter: "Adaptive Limiter",
  },
  "FL Studio": {
    gate: "Fruity Peak Controller",
    highpass: "Parametric EQ 2",
    subtractive_eq: "Parametric EQ 2",
    compressor_primary: "Fruity Peak Controller",
    compressor_secondary: "Maximus",
    additive_eq: "Parametric EQ 2",
    deesser: "Parametric EQ 2",
    saturation: "Fruity WaveShaper",
    reverb_bus_reverb: "Fruity Reeverb 2",
    reverb_bus_comp: "Fruity Peak Controller",
    delay_bus: "Fruity Delay 3",
    parallel_comp_bus: "Maximus",
    width_bus: "Fruity Stereo Enhancer",
    saturation_bus: "Fruity WaveShaper",
    mastering_bus_comp: "Maximus",
    mastering_limiter: "Fruity Limiter",
  },
  "Ableton Live": {
    gate: "Gate",
    highpass: "EQ Eight",
    subtractive_eq: "EQ Eight",
    compressor_primary: "Compressor",
    compressor_secondary: "Glue Compressor",
    additive_eq: "EQ Eight",
    deesser: "Multiband Dynamics",
    saturation: "Saturator",
    reverb_bus_reverb: "Reverb",
    reverb_bus_comp: "Compressor",
    delay_bus: "Simple Delay",
    parallel_comp_bus: "Compressor",
    width_bus: "Chorus-Ensemble",
    saturation_bus: "Saturator",
    mastering_bus_comp: "Glue Compressor",
    mastering_limiter: "Limiter",
  },
  "Pro Tools": {
    gate: "ReaGate",
    highpass: "EQ3 7-Band",
    subtractive_eq: "EQ3 7-Band",
    compressor_primary: "BF-76",
    compressor_secondary: "LA-2A",
    additive_eq: "EQ3 7-Band",
    deesser: "DeEsser",
    saturation: "AIR Distortion",
    reverb_bus_reverb: "AIR Reverb",
    reverb_bus_comp: "76",
    delay_bus: "AIR Dynamic Delay",
    parallel_comp_bus: "BF-76",
    width_bus: "AIR Stereo Width",
    saturation_bus: "AIR Distortion",
    mastering_bus_comp: "BF-2A",
    mastering_limiter: "L1 Ultramaximizer",
  },
} satisfies Record<string, Record<string, string>>;

type DawName = keyof typeof DAW_PLUGINS;
type DawPlugins = (typeof DAW_PLUGINS)[DawName];

type EqCut = { frequency_hz: number; gain_db: number; q: number };
type EqBoost = EqCut & { type: "bell" | "shelf" };

interface ChainPayload {
  main_chain: {
    gate: {
      threshold_db: number;
      attack_ms: number;
      release_ms: number;
      plugin: string;
    };
    highpass: {
      frequency_hz: number;
      slope: "12dB/oct" | "24dB/oct";
      plugin: string;
    };
    subtractive_eq: { cuts: EqCut[]; plugin: string };
    compressor_primary: {
      style: GenreProfile["compression"]["primary"]["style"];
      ratio: string;
      attack_ms: number;
      release_ms: number;
      threshold_db: number;
      gain_reduction_db: number;
      plugin: string;
    };
    compressor_secondary?: { settings: string; plugin: string };
    additive_eq: { boosts: EqBoost[]; plugin: string };
    deesser: {
      frequency_hz: number;
      reduction_db: number;
      plugin: string;
    };
    saturation?: { drive: number; mix_percent: number; plugin: string };
  };
  buses: {
    reverb_bus: {
      reverb: {
        decay_s: number;
        pre_delay_ms: number;
        mix_percent: number;
        plugin: string;
      };
      compressor?: {
        sidechained_to_dry_vocal: boolean;
        threshold_db: number;
        ratio: string;
        plugin: string;
        note: string;
      };
    };
    delay_bus: {
      time: string;
      feedback_percent: number;
      mix_percent: number;
      automated_on_phrase_endings: boolean;
      plugin: string;
    };
    parallel_comp_bus?: {
      ratio: string;
      attack_ms: number;
      threshold_db: number;
      blend_percent: number;
      plugin: string;
      note: string;
    };
    width_bus?: { amount_percent: number; plugin: string };
    saturation_bus?: { style: string; mix_percent: number; plugin: string };
    distortion_bus?: { style: string; blend_percent: number; plugin: string };
    mastering_bus: {
      bus_comp: {
        ratio: string;
        attack_ms: number;
        release_ms: number;
        gain_reduction_db: number;
        plugin: string;
      };
      limiter: { ceiling_db: number; plugin: string };
    };
  };
  engineer_note: string;
}

interface ClaudeChainResponse {
  chain: ChainStep[];
  summary: string;
  xyPosition: XYPosition;
  engineer_note: string;
}

const SYSTEM_PROMPT =
  "Return only concise explanation text. Do not return JSON, chain settings, plugin parameter values, verdicts, or scores.";

function readAudioServiceStatus(value: unknown): AudioServiceStatus {
  return value === "ok" ||
    value === "fallback" ||
    value === "error" ||
    value === "unknown"
    ? value
    : "unknown";
}

function readFallbackUsed(value: unknown) {
  return typeof value === "boolean" ? value : true;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clamp01 = (value: number) => clamp(value, 0, 1);

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function getDawName(daw: string): DawName {
  if (daw in DAW_PLUGINS) return daw as DawName;

  const lower = daw.toLowerCase();
  if (lower.includes("fl")) return "FL Studio";
  if (lower.includes("ableton")) return "Ableton Live";
  if (lower.includes("pro tools")) return "Pro Tools";

  return "Logic Pro";
}

function buildPrompt(
  metrics: AudioMetrics,
  daw: string,
  eraId: string,
  xyX?: number,
  xyY?: number
): string {
  const dawName = getDawName(daw);
  const genre = getGenreName(eraId);
  const profile = GENRE_PROFILES[genre];
  const lufsDelta = metrics.lufs - profile.lufs_target;
  const dynamicRangeDelta = metrics.dynamicRange - profile.dynamic_range_target;
  const truePeak = metrics.truePeak ?? "unknown";
  const lufsRule =
    lufsDelta > 0
      ? `${round(lufsDelta)} dB above`
      : `${round(Math.abs(lufsDelta))} dB below`;
  const brightnessRule =
    metrics.spectralCentroid < 2000
      ? "dark (below 2kHz), increase air EQ boost"
      : metrics.spectralCentroid > 3000
        ? "bright (above 3kHz), reduce air EQ boost"
        : "balanced, keep profile EQ close to baseline";

  return `You are a technical vocal mixing assistant specializing in ${genre}.

Vocal metrics:
- Integrated LUFS: ${round(metrics.lufs)} (target: ${profile.lufs_target})
- Dynamic range: ${round(metrics.dynamicRange)} LRA (target: ${profile.dynamic_range_target})
- Spectral centroid: ${Math.round(metrics.spectralCentroid)} Hz
- Sibilance peak: ${round(metrics.sibilancePeak ?? -12)} dBFS
- True peak: ${truePeak} dBFS
- Dry/wet preference: ${xyX == null ? "profile default" : round(xyX, 2)} (0 = dry, 1 = wet)
- Dark/bright preference: ${xyY == null ? "profile default" : round(xyY, 2)} (0 = dark, 1 = bright)

Deterministic context:
- mimiq calculates every gate, high-pass, compressor, EQ, de-esser, saturation, bus, and limiter setting locally from the measured metrics and the ${dawName} profile.
- The loudness rule is: the vocal is ${lufsRule} the target.
- The dynamics rule is: the vocal is ${dynamicRangeDelta > 0 ? "wider than target" : "tighter than target"}.
- The brightness rule is: ${brightnessRule}.

Respond with explanation text only, no JSON parameter values. Write one concise sentence explaining why the deterministic chain direction makes sense for this measured vocal.`;
}

function ratioValue(ratio: string) {
  if (ratio.toLowerCase().includes("all")) return 12;

  const match = ratio.match(/(\d+(?:\.\d+)?):1/);
  return match ? Number(match[1]) : 3;
}

function adjustRatio(base: string, dynamicDelta: number) {
  if (base.toLowerCase().includes("all")) return base;

  const ratio = ratioValue(base);
  const adjusted = clamp(ratio + dynamicDelta * 0.35, 1, 10);
  const rounded = round(adjusted, Number.isInteger(adjusted) ? 0 : 1);
  return `${rounded}:1`;
}

function buildEngineerNote(metrics: AudioMetrics, profile: GenreProfile, genre: GenreName) {
  const lufsGap = round(profile.lufs_target - metrics.lufs);
  const dynamicGap = round(metrics.dynamicRange - profile.dynamic_range_target);
  const sibilance = round(metrics.sibilancePeak ?? -12);

  if (Math.abs(lufsGap) >= 2) {
    return lufsGap > 0
      ? `Your vocal is ${lufsGap} dB quiet for ${genre} (${round(metrics.lufs)} LUFS vs ${profile.lufs_target} LUFS), so the primary compressor threshold was pulled lower while the limiter ceiling stays protected.`
      : `Your vocal is ${Math.abs(lufsGap)} dB loud for ${genre} (${round(metrics.lufs)} LUFS vs ${profile.lufs_target} LUFS), so compression is held tighter before the mastering limiter.`;
  }

  if (Math.abs(dynamicGap) >= 1) {
    return dynamicGap > 0
      ? `Your ${round(metrics.dynamicRange)} LRA dynamic range is ${dynamicGap} dB wider than the ${genre} target, so the primary compression ratio was increased without changing the bus structure.`
      : `Your ${round(metrics.dynamicRange)} LRA dynamic range is already tighter than the ${genre} target, so the chain keeps compression close to the profile baseline.`;
  }

  if (sibilance > -12) {
    return `Your sibilance peak is ${sibilance} dBFS, so the de-esser is pushed harder while the air shelf stays controlled.`;
  }

  return `Your spectral centroid is ${Math.round(metrics.spectralCentroid)} Hz, so the profile EQ stays focused around the ${genre} brightness target instead of inventing a new chain.`;
}

function primaryCompressorPlugin(profile: GenreProfile, plugins: DawPlugins) {
  return profile.compression.primary.style === "OPTICAL_LA2A" ||
    profile.compression.primary.style === "TUBE_CL1B"
    ? plugins.compressor_secondary
    : plugins.compressor_primary;
}

function buildDeterministicPayload(
  metrics: AudioMetrics,
  genre: GenreName,
  dawName: DawName,
  xyX?: number,
  xyY?: number
): ChainPayload {
  const profile = GENRE_PROFILES[genre];
  const plugins = DAW_PLUGINS[dawName];
  const dynamicDelta = metrics.dynamicRange - profile.dynamic_range_target;
  const quietGap = Math.max(0, profile.lufs_target - metrics.lufs);
  const loudGap = Math.max(0, metrics.lufs - profile.lufs_target);
  const sibilance = metrics.sibilancePeak ?? -12;
  const centroid = metrics.spectralCentroid;
  const wetScale = xyX == null ? 1 : clamp(0.7 + xyX * 0.6, 0.7, 1.3);
  const brightOffset = xyY == null ? 0 : (xyY - 0.5) * 1.4;
  const darkBoost = centroid < 2000 ? clamp((2000 - centroid) / 700, 0, 2) : 0;
  const brightCut = centroid > 3000 ? clamp((centroid - 3000) / 900, 0, 2) : 0;
  const primary = profile.compression.primary;
  const gateThreshold = profile.gate.threshold_db + clamp((metrics.breathNoise ?? -45) + 45, -4, 4);
  const highpass = profile.eq.highpass_hz + clamp((metrics.lowEndEnergy ?? 0.3) * 18, 0, 18);
  const deessBoost = sibilance > -12 ? clamp((sibilance + 12) * 0.75, 0, 3) : -0.25;
  const compressorThreshold =
    primary.threshold_db - quietGap * 0.5 + loudGap * 0.35 - Math.max(0, dynamicDelta) * 0.35;

  const boosts = profile.eq.additive.map((boost) => ({
    frequency_hz: boost.frequency,
    gain_db: round(
      boost.gain_db +
        (boost.type === "shelf" ? darkBoost - brightCut + brightOffset : brightOffset * 0.45),
      1
    ),
    q: boost.q,
    type: boost.type,
  }));

  return {
    main_chain: {
      gate: {
        threshold_db: round(clamp(gateThreshold, -60, -28)),
        attack_ms: profile.gate.attack_ms,
        release_ms: profile.gate.release_ms,
        plugin: plugins.gate,
      },
      highpass: {
        frequency_hz: Math.round(clamp(highpass, 60, 150)),
        slope: highpass >= 110 ? "24dB/oct" : "12dB/oct",
        plugin: plugins.highpass,
      },
      subtractive_eq: {
        cuts: profile.eq.subtractive.map((cut) => ({
          frequency_hz: cut.frequency,
          gain_db: round(cut.gain_db - clamp((metrics.lowEndEnergy ?? 0.3) * 0.8, 0, 1)),
          q: cut.q,
        })),
        plugin: plugins.subtractive_eq,
      },
      compressor_primary: {
        style: primary.style,
        ratio: adjustRatio(primary.ratio, dynamicDelta),
        attack_ms: primary.attack_ms,
        release_ms: Math.round(clamp(primary.release_ms + Math.max(0, dynamicDelta) * 8, 35, 700)),
        threshold_db: round(clamp(compressorThreshold, -36, -12)),
        gain_reduction_db: round(
          clamp(primary.gain_reduction_db + Math.max(0, dynamicDelta) * 0.7 + loudGap * 0.25, 1, 12)
        ),
        plugin: primaryCompressorPlugin(profile, plugins),
      },
      ...(profile.compression.secondary
        ? {
            compressor_secondary: {
              settings: profile.compression.secondary.settings,
              plugin: plugins.compressor_secondary,
            },
          }
        : {}),
      additive_eq: { boosts, plugin: plugins.additive_eq },
      deesser: {
        frequency_hz: profile.deesser.frequency,
        reduction_db: round(clamp(profile.deesser.reduction_db + deessBoost, 1, 8)),
        plugin: plugins.deesser,
      },
      ...(profile.saturation.character !== "none" && profile.saturation.mix_percent > 0
        ? {
            saturation: {
              drive: Math.round(clamp(profile.saturation.drive + quietGap * 0.3, 1, 35)),
              mix_percent: Math.round(clamp(profile.saturation.mix_percent, 1, 25)),
              plugin: plugins.saturation,
            },
          }
        : {}),
    },
    buses: {
      reverb_bus: {
        reverb: {
          decay_s: round(profile.buses.reverb.decay_s, 2),
          pre_delay_ms: Math.round(profile.buses.reverb.pre_delay_ms),
          mix_percent: Math.round(clamp(profile.buses.reverb.mix_percent * wetScale, 3, 35)),
          plugin: plugins.reverb_bus_reverb,
        },
        ...(profile.buses.reverb.sidechained
          ? {
              compressor: {
                sidechained_to_dry_vocal: true,
                threshold_db: Math.round(clamp(-24 - quietGap * 0.4, -34, -16)),
                ratio: "4:1",
                plugin: plugins.reverb_bus_comp,
                note: "Sidechain to dry vocal so reverb ducks when artist raps",
              },
            }
          : {}),
      },
      delay_bus: {
        time: profile.buses.delay.time,
        feedback_percent: Math.round(profile.buses.delay.feedback_percent),
        mix_percent: Math.round(clamp(profile.buses.delay.mix_percent * wetScale, 3, 30)),
        automated_on_phrase_endings: profile.buses.delay.automated,
        plugin: plugins.delay_bus,
      },
      ...(profile.buses.parallel_comp
        ? {
            parallel_comp_bus: {
              ratio: adjustRatio(profile.buses.parallel_comp.ratio, dynamicDelta),
              attack_ms: profile.buses.parallel_comp.attack_ms,
              threshold_db: -30,
              blend_percent: Math.round(
                clamp(profile.buses.parallel_comp.blend_percent + Math.max(0, dynamicDelta) * 1.5, 5, 35)
              ),
              plugin: plugins.parallel_comp_bus,
              note: "Blend in parallel for density without losing dynamics",
            },
          }
        : {}),
      ...(profile.buses.width && profile.buses.width.style !== "none"
        ? {
            width_bus: {
              amount_percent: Math.round(clamp(profile.buses.width.amount_percent * wetScale, 1, 45)),
              plugin: plugins.width_bus,
            },
          }
        : {}),
      ...(profile.buses.saturation_bus
        ? {
            saturation_bus: {
              style: profile.buses.saturation_bus.style,
              mix_percent: Math.round(clamp(profile.buses.saturation_bus.mix_percent * wetScale, 1, 18)),
              plugin: plugins.saturation_bus,
            },
          }
        : {}),
      ...(profile.buses.distortion_bus
        ? {
            distortion_bus: {
              style: profile.buses.distortion_bus.style,
              blend_percent: Math.round(clamp(profile.buses.distortion_bus.blend_percent, 5, 20)),
              plugin: plugins.saturation_bus,
            },
          }
        : {}),
      mastering_bus: {
        bus_comp: {
          ratio: profile.buses.mastering.bus_comp.ratio,
          attack_ms: profile.buses.mastering.bus_comp.attack_ms,
          release_ms: profile.buses.mastering.bus_comp.release_ms,
          gain_reduction_db: round(
            clamp(profile.buses.mastering.bus_comp.gain_reduction_db + loudGap * 0.15, 0, 4)
          ),
          plugin: plugins.mastering_bus_comp,
        },
        limiter: {
          ceiling_db: profile.buses.mastering.limiter_ceiling_db,
          plugin: plugins.mastering_limiter,
        },
      },
    },
    engineer_note: buildEngineerNote(metrics, profile, genre),
  };
}

function formatHz(value: number) {
  return value >= 1000 ? `${round(value / 1000, value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

function formatDb(value: number) {
  return `${value > 0 ? "+" : ""}${round(value)} dB`;
}

function formatCuts(cuts: EqCut[]) {
  return cuts
    .map((cut) => `${formatDb(cut.gain_db)} at ${formatHz(cut.frequency_hz)}, Q ${cut.q}`)
    .join("; ");
}

function formatBoosts(boosts: EqBoost[]) {
  return boosts
    .map((boost) => `${boost.type === "shelf" ? "Shelf" : "Boost"} ${formatDb(boost.gain_db)} at ${formatHz(boost.frequency_hz)}, Q ${boost.q}`)
    .join("; ");
}

function buildChain(payload: ChainPayload, metrics: AudioMetrics, genre: GenreName): ChainStep[] {
  const steps: ChainStep[] = [];
  const profile = GENRE_PROFILES[genre];
  const push = (step: Omit<ChainStep, "step">) => {
    steps.push({ step: steps.length + 1, ...step });
  };

  push({
    bus: "main",
    role: "gate",
    tool: payload.main_chain.gate.plugin,
    action: `Threshold ${formatDb(payload.main_chain.gate.threshold_db)}, attack ${payload.main_chain.gate.attack_ms} ms, release ${payload.main_chain.gate.release_ms} ms`,
    reason: `The ${round(metrics.breathNoise ?? -45)} dB noise floor is cleaned before the ${genre} dynamics stack raises room tone.`,
  });
  push({
    bus: "main",
    role: "highpass",
    tool: payload.main_chain.highpass.plugin,
    action: `High-pass at ${formatHz(payload.main_chain.highpass.frequency_hz)}, ${payload.main_chain.highpass.slope}`,
    reason: `The ${genre} profile keeps vocal fundamentals clear while leaving the beat low end alone.`,
  });
  push({
    bus: "main",
    role: "subtractive_eq",
    tool: payload.main_chain.subtractive_eq.plugin,
    action: formatCuts(payload.main_chain.subtractive_eq.cuts),
    reason: `Subtractive EQ follows the genre-specific low-mid carving before presence and air are added.`,
  });
  push({
    bus: "main",
    role: "compressor_primary",
    tool: payload.main_chain.compressor_primary.plugin,
    action: `${payload.main_chain.compressor_primary.style}, ${payload.main_chain.compressor_primary.ratio}, attack ${payload.main_chain.compressor_primary.attack_ms} ms, release ${payload.main_chain.compressor_primary.release_ms} ms, threshold ${formatDb(payload.main_chain.compressor_primary.threshold_db)}, ${formatDb(payload.main_chain.compressor_primary.gain_reduction_db)} GR`,
    reason: `${round(metrics.dynamicRange)} LRA is measured against the ${profile.dynamic_range_target} LRA ${genre} target.`,
  });

  if (payload.main_chain.compressor_secondary) {
    push({
      bus: "main",
      role: "compressor_secondary",
      tool: payload.main_chain.compressor_secondary.plugin,
      action: payload.main_chain.compressor_secondary.settings,
      reason: `Serial leveling is part of the ${genre} profile rather than a generic second compressor.`,
    });
  }

  push({
    bus: "main",
    role: "additive_eq",
    tool: payload.main_chain.additive_eq.plugin,
    action: formatBoosts(payload.main_chain.additive_eq.boosts),
    reason: `${Math.round(metrics.spectralCentroid)} Hz spectral centroid sets how far the profile presence and air are adjusted.`,
  });
  push({
    bus: "main",
    role: "deesser",
    tool: payload.main_chain.deesser.plugin,
    action: `Target ${formatHz(payload.main_chain.deesser.frequency_hz)}, reduce ${formatDb(payload.main_chain.deesser.reduction_db)}`,
    reason: `${round(metrics.sibilancePeak ?? -12)} dBFS sibilance determines reduction without changing the chain order.`,
  });

  if (payload.main_chain.saturation) {
    push({
      bus: "main",
      role: "saturation",
      tool: payload.main_chain.saturation.plugin,
      action: `Drive ${payload.main_chain.saturation.drive}/100, mix ${payload.main_chain.saturation.mix_percent}%`,
      reason: `The ${genre} profile calls for ${profile.saturation.character} harmonic density in the main vocal path.`,
    });
  }

  push({
    bus: "reverb_bus",
    role: "reverb_bus_reverb",
    sendPoint: "post-chain",
    tool: payload.buses.reverb_bus.reverb.plugin,
    action: `${profile.buses.reverb.character}, decay ${payload.buses.reverb_bus.reverb.decay_s} s, pre-delay ${payload.buses.reverb_bus.reverb.pre_delay_ms} ms, mix ${payload.buses.reverb_bus.reverb.mix_percent}%`,
    reason: `The reverb send stays post-chain so the processed vocal feeds the space consistently.`,
  });

  if (payload.buses.reverb_bus.compressor) {
    push({
      bus: "reverb_bus",
      role: "reverb_bus_comp",
      sendPoint: "post-chain",
      tool: payload.buses.reverb_bus.compressor.plugin,
      action: `Sidechain duck, threshold ${formatDb(payload.buses.reverb_bus.compressor.threshold_db)}, ratio ${payload.buses.reverb_bus.compressor.ratio}`,
      reason: `The reverb ducks around the dry vocal so depth does not blur consonants.`,
      note: payload.buses.reverb_bus.compressor.note,
    });
  }

  push({
    bus: "delay_bus",
    role: "delay_bus",
    sendPoint: "post-chain",
    tool: payload.buses.delay_bus.plugin,
    action: `${payload.buses.delay_bus.time} note, feedback ${payload.buses.delay_bus.feedback_percent}%, mix ${payload.buses.delay_bus.mix_percent}%`,
    reason: payload.buses.delay_bus.automated_on_phrase_endings
      ? "Send automation keeps delay throws on phrase endings."
      : "A low static slap keeps movement tight without washing the vocal out.",
  });

  if (payload.buses.parallel_comp_bus) {
    push({
      bus: "parallel_comp_bus",
      role: "parallel_comp_bus",
      sendPoint: "after-compressor-primary",
      tool: payload.buses.parallel_comp_bus.plugin,
      action: `${payload.buses.parallel_comp_bus.ratio}, attack ${payload.buses.parallel_comp_bus.attack_ms} ms, threshold ${formatDb(payload.buses.parallel_comp_bus.threshold_db)}, blend ${payload.buses.parallel_comp_bus.blend_percent}%`,
      reason: "The send leaves after the first compressor so density can be blended back before the final return.",
      note: payload.buses.parallel_comp_bus.note,
    });
  }

  if (payload.buses.width_bus) {
    push({
      bus: "width_bus",
      role: "width_bus",
      sendPoint: "post-chain",
      tool: payload.buses.width_bus.plugin,
      action: `${profile.buses.width?.style ?? "width"} width, amount ${payload.buses.width_bus.amount_percent}%`,
      reason: `Width follows the ${genre} profile instead of widening every genre the same way.`,
    });
  }

  if (payload.buses.saturation_bus) {
    push({
      bus: "saturation_bus",
      role: "saturation_bus",
      sendPoint: "post-chain",
      tool: payload.buses.saturation_bus.plugin,
      action: `${payload.buses.saturation_bus.style}, mix ${payload.buses.saturation_bus.mix_percent}%`,
      reason: "This send adds warmth in parallel without forcing saturation into the dry vocal path.",
    });
  }

  if (payload.buses.distortion_bus) {
    push({
      bus: "distortion_bus",
      role: "distortion_bus",
      sendPoint: "post-chain",
      tool: payload.buses.distortion_bus.plugin,
      action: `${payload.buses.distortion_bus.style}, blend ${payload.buses.distortion_bus.blend_percent}%`,
      reason: "The grit is isolated on its own bus so edge can be blended without losing intelligibility.",
    });
  }

  push({
    bus: "mastering_bus",
    role: "mastering_bus_comp",
    sendPoint: "return",
    tool: payload.buses.mastering_bus.bus_comp.plugin,
    action: `${payload.buses.mastering_bus.bus_comp.ratio}, attack ${payload.buses.mastering_bus.bus_comp.attack_ms} ms, release ${payload.buses.mastering_bus.bus_comp.release_ms} ms, ${formatDb(payload.buses.mastering_bus.bus_comp.gain_reduction_db)} GR`,
    reason: "All vocal paths return here for final glue before limiting.",
  });
  push({
    bus: "mastering_bus",
    role: "mastering_limiter",
    sendPoint: "return",
    tool: payload.buses.mastering_bus.limiter.plugin,
    action: `Ceiling ${formatDb(payload.buses.mastering_bus.limiter.ceiling_db)}`,
    reason: `The limiter keeps the vocal chain inside the ${genre} loudness target without changing the genre buses.`,
  });

  return steps;
}

function buildSummary(metrics: AudioMetrics, genre: GenreName) {
  const profile = GENRE_PROFILES[genre];
  return `${genre} chain targeting ${profile.lufs_target} LUFS and ${profile.dynamic_range_target} LRA from a ${round(metrics.lufs)} LUFS vocal. ${profile.philosophy}`;
}

function buildXYPosition(payload: ChainPayload, xyX?: number, xyY?: number): XYPosition {
  const shelf = payload.main_chain.additive_eq.boosts.find((boost) => boost.type === "shelf");

  return {
    x: clamp01(
      xyX ??
        (payload.buses.reverb_bus.reverb.mix_percent +
          payload.buses.delay_bus.mix_percent +
          (payload.buses.width_bus?.amount_percent ?? 0)) /
          90
    ),
    y: clamp01(xyY ?? (((shelf?.gain_db ?? 2) + 2) / 8)),
  };
}

function buildChainResponse(
  metrics: AudioMetrics,
  daw: string,
  eraId: string,
  xyX?: number,
  xyY?: number
): ClaudeChainResponse {
  const genre = getGenreName(eraId);
  const payload = buildDeterministicPayload(metrics, genre, getDawName(daw), xyX, xyY);

  return {
    chain: buildChain(payload, metrics, genre),
    summary: buildSummary(metrics, genre),
    xyPosition: buildXYPosition(payload, xyX, xyY),
    engineer_note: payload.engineer_note,
  };
}

async function callClaudeWithRetry(params: {
  prompt: string;
  metrics: AudioMetrics;
  daw: string;
  eraId: string;
  xyX?: number;
  xyY?: number;
}): Promise<ClaudeChainResponse> {
  const deterministic = buildChainResponse(
    params.metrics,
    params.daw,
    params.eraId,
    params.xyX,
    params.xyY
  );
  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (err) {
    console.error("[analyze] Claude client unavailable:", err);
    console.warn("[analyze] Using deterministic local chain fallback.");
    return deterministic;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: params.prompt }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") continue;

      const explanation = textBlock.text.trim();
      if (explanation) {
        return { ...deterministic, engineer_note: explanation };
      }
    } catch (err) {
      console.error(`[analyze] Claude API error (attempt ${attempt + 1}):`, err);
      if (attempt === 1) break;
    }
  }

  console.warn("[analyze] Using deterministic local chain fallback.");
  return deterministic;
}

/* ═══════════════════════════════════════════════════════════════
   Audio service call
   ═══════════════════════════════════════════════════════════════ */

const numberOr = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const metricNumber = (fallback: number, ...values: unknown[]) => {
  for (const value of values) {
    const parsed = numberOr(value, Number.NaN);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const normalizeDb = (value: unknown, min: number, max: number) => {
  const db = numberOr(value, min);
  return Math.max(0, Math.min(1, (db - min) / (max - min)));
};

function getGenreDefaultMetrics(eraId: string, beatFile?: File | null): AudioMetrics {
  const defaults: Record<string, AudioMetrics> = {
    nocturnal: {
      lufs: -18,
      dynamicRange: 8,
      spectralCentroid: 1800,
      reverbDecay: 0.5,
      sibilancePeak: -14,
      pitchVariance: 0.45,
      breathNoise: -46,
      dynamicInconsistency: 0.32,
      lowEndEnergy: 0.32,
      stereoWidth: 0.2,
      reverbEstimate: 0.24,
    },
    volatile: {
      lufs: -15,
      dynamicRange: 6,
      spectralCentroid: 2600,
      reverbDecay: 0.22,
      sibilancePeak: -11,
      pitchVariance: 0.58,
      breathNoise: -43,
      dynamicInconsistency: 0.42,
      lowEndEnergy: 0.42,
      stereoWidth: 0.16,
      reverbEstimate: 0.12,
    },
    current: {
      lufs: -16,
      dynamicRange: 7,
      spectralCentroid: 2300,
      reverbDecay: 0.38,
      sibilancePeak: -12,
      pitchVariance: 0.52,
      breathNoise: -45,
      dynamicInconsistency: 0.34,
      lowEndEnergy: 0.34,
      stereoWidth: 0.24,
      reverbEstimate: 0.18,
    },
    golden: {
      lufs: -17,
      dynamicRange: 9,
      spectralCentroid: 1900,
      reverbDecay: 0.24,
      sibilancePeak: -15,
      pitchVariance: 0.42,
      breathNoise: -48,
      dynamicInconsistency: 0.28,
      lowEndEnergy: 0.3,
      stereoWidth: 0.1,
      reverbEstimate: 0.1,
    },
    crystalline: {
      lufs: -16,
      dynamicRange: 6.5,
      spectralCentroid: 3000,
      reverbDecay: 0.28,
      sibilancePeak: -10,
      pitchVariance: 0.5,
      breathNoise: -44,
      dynamicInconsistency: 0.36,
      lowEndEnergy: 0.24,
      stereoWidth: 0.14,
      reverbEstimate: 0.09,
    },
    foryou: {
      lufs: -15,
      dynamicRange: 6,
      spectralCentroid: 2200,
      reverbDecay: 0.32,
      sibilancePeak: -12,
      pitchVariance: 0.46,
      breathNoise: -46,
      dynamicInconsistency: 0.3,
      lowEndEnergy: 0.28,
      stereoWidth: 0.18,
      reverbEstimate: 0.14,
    },
  };

  const aliases: Record<string, string> = {
    rnb: "nocturnal",
    trap: "volatile",
    foryou: "foryou",
  };
  const metrics = defaults[eraId] ?? defaults[aliases[eraId]] ?? defaults.golden;
  return {
    ...metrics,
    beatLufs: beatFile ? -12.8 : undefined,
    collisionFrequency: beatFile ? 350 : undefined,
  };
}

function completeMetrics(
  metrics: Partial<AudioMetrics>,
  eraId: string,
  beatFile?: File | null
): AudioMetrics {
  const defaults = getGenreDefaultMetrics(eraId, beatFile);
  return {
    ...defaults,
    ...metrics,
    lufs: numberOr(metrics.lufs, defaults.lufs),
    dynamicRange: numberOr(metrics.dynamicRange, defaults.dynamicRange),
    truePeak: metrics.truePeak,
    spectralCentroid: numberOr(metrics.spectralCentroid, defaults.spectralCentroid),
    reverbDecay: numberOr(metrics.reverbDecay, defaults.reverbDecay ?? 0.3),
    sibilancePeak: numberOr(metrics.sibilancePeak, defaults.sibilancePeak ?? -12),
    pitchVariance: numberOr(metrics.pitchVariance, defaults.pitchVariance ?? 0.5),
    breathNoise: numberOr(metrics.breathNoise, defaults.breathNoise ?? -45),
    dynamicInconsistency: numberOr(
      metrics.dynamicInconsistency,
      defaults.dynamicInconsistency ?? 0.3
    ),
    lowEndEnergy: numberOr(metrics.lowEndEnergy, defaults.lowEndEnergy),
    stereoWidth: numberOr(metrics.stereoWidth, defaults.stereoWidth),
    reverbEstimate: numberOr(metrics.reverbEstimate, defaults.reverbEstimate),
  };
}

function parseClientMetrics(header: string | null): Partial<AudioMetrics> {
  if (!header) return {};

  try {
    const metrics = JSON.parse(header) as Partial<AudioMetrics>;
    return {
      lufs: Number.isFinite(metrics.lufs) ? metrics.lufs : undefined,
      dynamicRange: Number.isFinite(metrics.dynamicRange)
        ? metrics.dynamicRange
        : undefined,
    };
  } catch {
    return {};
  }
}

function withClientMetricsFallback(
  clientMetrics: Partial<AudioMetrics>,
  eraId: string,
  beatFile: File | null
): AudioMetrics {
  const defaults = getGenreDefaultMetrics(eraId, beatFile);
  return {
    ...defaults,
    lufs: numberOr(clientMetrics.lufs, defaults.lufs),
    dynamicRange: numberOr(clientMetrics.dynamicRange, defaults.dynamicRange),
  };
}

function transformAudioServiceResponse(raw: unknown): AudioMetrics {
  const data = raw as FastAPIAnalyzeResponse;
  const vocal = (data.vocal ?? raw ?? {}) as FastAPIMetrics;
  const beat = data.beat ?? null;
  const firstCollision = data.frequency_collisions?.[0];

  return {
    lufs: metricNumber(-18, vocal.lufs_integrated, vocal.lufs),
    dynamicRange: metricNumber(7, vocal.dynamic_range, vocal.dynamicRange),
    truePeak: metricNumber(
      -1,
      vocal.true_peak,
      vocal.truePeak,
      vocal.true_peak_estimate_db,
      vocal.truePeakEstimateDb,
      vocal.peak_db
    ),
    sibilanceEnergy: metricNumber(
      0,
      vocal.sibilance_energy,
      vocal.sibilanceEnergy
    ),
    harshness: metricNumber(0, vocal.harshness),
    lowMidBuildup: metricNumber(
      0,
      vocal.low_mid_buildup,
      vocal.lowMidBuildup
    ),
    noiseFloorDb: metricNumber(
      -45,
      vocal.noise_floor_db,
      vocal.noiseFloorDb
    ),
    truePeakEstimateDb: metricNumber(
      -1,
      vocal.true_peak_estimate_db,
      vocal.truePeakEstimateDb
    ),
    crestFactorDb: metricNumber(
      0,
      vocal.crest_factor_db,
      vocal.crestFactorDb
    ),
    spectralCentroid: metricNumber(
      2000,
      vocal.spectral_centroid,
      vocal.spectralCentroid
    ),
    reverbDecay: metricNumber(0.3, vocal.reverb_decay, vocal.reverbDecay),
    sibilancePeak: metricNumber(-12, vocal.sibilance_peak, vocal.sibilancePeak),
    pitchVariance: metricNumber(0.5, vocal.pitch_variance, vocal.pitchVariance),
    breathNoise: metricNumber(-45, vocal.breath_noise, vocal.breathNoise),
    dynamicInconsistency: metricNumber(
      0.3,
      vocal.dynamic_inconsistency,
      vocal.dynamicInconsistency
    ),
    lowEndEnergy: metricNumber(
      normalizeDb(vocal.rms_db, -45, -8),
      vocal.low_end_energy,
      vocal.lowEndEnergy
    ),
    stereoWidth: metricNumber(0, vocal.stereo_width, vocal.stereoWidth),
    reverbEstimate: metricNumber(
      metricNumber(0.1, vocal.reverb_decay, vocal.reverbDecay),
      vocal.reverb_estimate,
      vocal.reverbEstimate,
      vocal.spectral_flatness
    ),
    beatLufs: beat
      ? metricNumber(-18, beat.lufs_integrated, beat.lufs)
      : undefined,
    collisionFrequency: firstCollision
      ? metricNumber(0, firstCollision.vocal_centroid, firstCollision.beat_centroid)
      : undefined,
  };
}

async function analyzeAudio(
  vocalFile: File,
  beatFile: File | null,
  eraId: string,
  clientMetrics: Partial<AudioMetrics>
): Promise<AudioAnalysisResult> {
  const serviceUrl = process.env.AUDIO_SERVICE_URL;
  if (!serviceUrl) {
    console.warn("[analyze] Using client-side metrics fallback.");
    return {
      metrics: withClientMetricsFallback(clientMetrics, eraId, beatFile),
      fallback_used: true,
      audio_service_status: "fallback",
    };
  }

  const form = new FormData();
  form.append("vocal", vocalFile);
  if (beatFile) form.append("beat", beatFile);

  try {
    const res = await fetch(`${serviceUrl}/analyze`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[analyze] Audio service returned ${res.status}.`);
      console.warn("[analyze] Using client-side metrics fallback.");
      return {
        metrics: withClientMetricsFallback(clientMetrics, eraId, beatFile),
        fallback_used: true,
        audio_service_status: "fallback",
      };
    }

    return {
      metrics: transformAudioServiceResponse(await res.json()),
      fallback_used: false,
      audio_service_status: "ok",
    };
  } catch (error) {
    console.warn("[analyze] Audio service unavailable.", error);
    console.warn("[analyze] Using client-side metrics fallback.");
    return {
      metrics: withClientMetricsFallback(clientMetrics, eraId, beatFile),
      fallback_used: true,
      audio_service_status: "fallback",
    };
  }
}

/* ═══════════════════════════════════════════════════════════════
   POST handler
   ═══════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const daw = (formData.get("daw") as string) || "Logic Pro";
    const eraId = (formData.get("era") as string) || "golden";
    const xyXRaw = formData.get("xyX") as string | null;
    const xyYRaw = formData.get("xyY") as string | null;
    const cachedMetricsRaw = formData.get("cachedMetrics") as string | null;
    const clientMetrics = parseClientMetrics(
      req.headers.get("x-client-audio-metrics")
    );

    const xyX = xyXRaw != null ? parseFloat(xyXRaw) : undefined;
    const xyY = xyYRaw != null ? parseFloat(xyYRaw) : undefined;

    /* ── Cached metrics path (XY drag / era switch — no audio re-upload) ── */
    if (cachedMetricsRaw) {
      let metrics: AudioMetrics;
      let cachedPayload: CachedMetricsPayload;
      try {
        cachedPayload = JSON.parse(cachedMetricsRaw) as CachedMetricsPayload;
        metrics = completeMetrics(cachedPayload, eraId);
      } catch {
        return NextResponse.json(
          { error: "analysis_failed", message: "Invalid cached metrics JSON." },
          { status: 400 }
        );
      }

      const prompt = buildPrompt(metrics, daw, eraId, xyX, xyY);
      const result = await callClaudeWithRetry({
        prompt,
        metrics,
        daw,
        eraId,
        xyX,
        xyY,
      });
      const fallbackUsed = readFallbackUsed(cachedPayload.fallback_used);
      const audioServiceStatus = readAudioServiceStatus(
        cachedPayload.audio_service_status
      );

      return NextResponse.json({
        chain: result.chain,
        summary: result.summary,
        engineer_note: result.engineer_note,
        xyPosition: result.xyPosition,
        metrics,
        analysis_version: "1.0",
        fallback_used: fallbackUsed,
        audio_service_status: audioServiceStatus,
      });
    }

    /* ── Full analysis path ── */
    const projectId = (formData.get("projectId") as string) || null;
    const vocalAssetId = (formData.get("vocalAssetId") as string) || null;
    const beatAssetId = (formData.get("beatAssetId") as string) || null;
    let vocalFile = formData.get("vocalFile") as File | null;
    let beatFile = formData.get("beatFile") as File | null;

    try {
      const vocalAsset = await resolveProjectAssetFile({
        req,
        projectId,
        assetId: vocalAssetId,
        allowedKinds: ["vocal", "full_song"],
        label: "Vocal",
      });
      const beatAsset = await resolveProjectAssetFile({
        req,
        projectId,
        assetId: beatAssetId,
        allowedKinds: ["beat"],
        label: "Beat",
      });

      vocalFile = vocalAsset?.file ?? vocalFile;
      beatFile = beatAsset?.file ?? beatFile;
    } catch (error) {
      const response = assetResolutionResponse(error);
      if (response) return response;
      throw error;
    }

    if (!vocalFile) {
      return NextResponse.json(
        { error: "analysis_failed", message: "No vocal file provided." },
        { status: 400 }
      );
    }

    // Server-side file size guard
    if (vocalFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "file_too_large",
          message: "Vocal file exceeds 20 MB limit.",
        },
        { status: 413 }
      );
    }

    if (beatFile && beatFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "file_too_large",
          message: "Beat file exceeds 20 MB limit.",
        },
        { status: 413 }
      );
    }

    /* Call Python audio analysis service */
    const audio = await analyzeAudio(vocalFile, beatFile, eraId, clientMetrics);
    const { metrics } = audio;

    /* Build prompt and call Claude */
    const prompt = buildPrompt(metrics, daw, eraId);
    const result = await callClaudeWithRetry({
      prompt,
      metrics,
      daw,
      eraId,
    });

    return NextResponse.json({
      chain: result.chain,
      summary: result.summary,
      engineer_note: result.engineer_note,
      xyPosition: result.xyPosition,
      metrics,
      analysis_version: "1.0",
      fallback_used: audio.fallback_used,
      audio_service_status: audio.audio_service_status,
    });
  } catch (err) {
    console.error("[analyze] Unexpected error:", err);
    return NextResponse.json(
      { error: "analysis_failed", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
