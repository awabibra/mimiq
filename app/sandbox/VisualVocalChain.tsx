"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  ChainStep,
  EvaluationIssue,
  EvaluationResult,
  EvaluationSeverity,
} from "@/lib/types";
import {
  DAW_PLUGINS,
  GENRE_PROFILES,
  getGenreName,
  type DawName,
  type GenreName,
} from "@/lib/chainKnowledge";
import { FeedbackPanel } from "./chainLab/FeedbackPanel";
import styles from "./VisualVocalChain.module.css";

interface VisualVocalChainProps {
  chain: ChainStep[] | null;
  engineerNote?: string | null;
  mode?: "view" | "edit";
  isDirty?: boolean;
  hasUnsavedChanges?: boolean;
  evaluating?: boolean;
  evaluationResult?: EvaluationResult | null;
  feedbackPanelOpen?: boolean;
  displayedMeasuredFit?: EvaluationResult["measured_fit"];
  currentGenre?: string;
  currentDaw?: string;
  measuredFit?: EvaluationResult["measured_fit"];
  assistantHighlight?: { step: number; nonce: number } | null;
  audioPulse?: number;
  onEnterEditMode?: () => void;
  onEditedChainChange?: (chain: ChainStep[]) => void;
  onEvaluate?: () => void;
  onConfirmSave?: () => void;
  onDiscard?: () => void;
  onFeedbackPanelOpenChange?: (open: boolean) => void;
}

interface NodeRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

type BusKind =
  | "reverb_bus"
  | "delay_bus"
  | "parallel_comp_bus"
  | "width_bus"
  | "saturation_bus"
  | "distortion_bus"
  | "mastering_bus";

type NodeKind = "main" | BusKind;
type AddTarget = "main" | BusKind;

interface VisualNode {
  id: string;
  step: ChainStep;
  kind: NodeKind;
}

interface MainSection {
  key: string;
  label: string;
  index: number;
  nodes: VisualNode[];
}

interface WirePath {
  id: string;
  d: string;
  isBranch?: boolean;
  sourceId: string;
  targetId: string;
}

type NumberParam = {
  kind: "number";
  key: string;
  label: string;
  value: number;
  unit: "dB" | "Hz" | "ms" | "s" | "%" | "Q";
  min: number;
  max: number;
  step: number;
};

type SelectParam = {
  kind: "select";
  key: string;
  label: string;
  value: string;
  options: string[];
};

type ToggleParam = {
  kind: "toggle";
  key: string;
  label: string;
  value: boolean;
};

type ParamControl = NumberParam | SelectParam | ToggleParam;
type PaletteCategory = keyof typeof PLUGIN_PALETTE;
type PalettePlugin = (typeof PLUGIN_PALETTE)[PaletteCategory][number];

const BUS_LABELS: Record<BusKind, string> = {
  reverb_bus: "reverb bus",
  delay_bus: "delay bus",
  parallel_comp_bus: "parallel comp",
  width_bus: "width bus",
  saturation_bus: "saturation bus",
  distortion_bus: "distortion bus",
  mastering_bus: "mastering return",
};

const BUS_ABBREVIATIONS: Record<BusKind, string> = {
  reverb_bus: "REV",
  delay_bus: "DLY",
  parallel_comp_bus: "PAR",
  width_bus: "WID",
  saturation_bus: "SAT",
  distortion_bus: "DIST",
  mastering_bus: "MSTR",
};

const BUS_ORDER: BusKind[] = [
  "reverb_bus",
  "delay_bus",
  "parallel_comp_bus",
  "width_bus",
  "saturation_bus",
  "distortion_bus",
  "mastering_bus",
];

const MAIN_SECTION_LABELS: Record<string, string> = {
  cleanup: "Cleanup",
  tone: "Tone Shaping",
  dynamics: "Dynamics",
  deessing: "De-essing",
  inserts: "Insert FX",
};

const PLUGIN_PALETTE = {
  Filtering: ["highpass", "lowpass", "notch_filter"],
  Dynamics: [
    "gate",
    "compressor_vca",
    "compressor_optical",
    "compressor_vari_mu",
    "limiter",
    "transient_shaper",
  ],
  EQ: ["subtractive_eq", "additive_eq", "air_eq", "tilt_eq"],
  Character: ["saturation", "tape_saturation", "tube_saturation", "exciter"],
  Correction: ["deesser", "pitch_correction", "noise_reduction"],
  Time: ["short_reverb", "long_reverb", "slap_delay", "rhythmic_delay", "chorus"],
} as const;

const RATIO_OPTIONS = [
  "1.5:1",
  "2:1",
  "3:1",
  "4:1",
  "6:1",
  "8:1",
  "10:1",
  "all-buttons",
];

const TIME_OPTIONS = ["1/16", "1/8", "1/8 dotted", "1/4", "1/4 dotted", "1/2"];
const SLOPE_OPTIONS = ["12dB/oct", "24dB/oct"];
const COMP_STYLE_OPTIONS = ["FET_1176", "OPTICAL_LA2A", "VCA_SSL", "TUBE_CL1B"];
const WIDTH_STYLE_OPTIONS = ["chorus", "microshift", "haas"];
const SATURATION_STYLE_OPTIONS = [
  "subtle tape warmth",
  "tape polish",
  "tube edge",
  "transistor grit",
];

function chunkBuses(buses: BusKind[], size: number) {
  const rows: BusKind[][] = [];

  for (let index = 0; index < buses.length; index += size) {
    rows.push(buses.slice(index, index + size));
  }

  return rows;
}

function buildBusRows(visibleBuses: BusKind[]) {
  const hasMastering = visibleBuses.includes("mastering_bus");
  if (!hasMastering) return chunkBuses(visibleBuses, 4);

  const creativeBuses = visibleBuses.filter((kind) => kind !== "mastering_bus");
  const firstRow = [...creativeBuses.slice(0, 3), "mastering_bus" as BusKind];
  const remainingRows = chunkBuses(creativeBuses.slice(3), 4);

  return [firstRow, ...remainingRows].filter((row) => row.length > 0);
}

function classifyStep(step: ChainStep): NodeKind {
  if (step.bus && step.bus !== "main") return step.bus;
  if (step.bus === "main") return "main";

  const text = `${step.tool} ${step.action} ${step.reason}`.toLowerCase();
  if (text.includes("reverb") || text.includes("verb")) return "reverb_bus";
  if (text.includes("delay") || text.includes("echo")) return "delay_bus";
  if (text.includes("parallel")) return "parallel_comp_bus";
  if (text.includes("width") || text.includes("chorus")) return "width_bus";
  if (text.includes("saturation") || text.includes("tape")) return "saturation_bus";
  if (text.includes("distortion") || text.includes("overdrive")) return "distortion_bus";
  if (text.includes("limiter") || text.includes("master")) return "mastering_bus";

  return "main";
}

function classifyMainSection(step: ChainStep) {
  const text = `${step.role ?? ""} ${step.tool} ${step.action}`.toLowerCase();
  if (
    text.includes("gate") ||
    text.includes("high-pass") ||
    text.includes("highpass") ||
    text.includes("noise")
  ) {
    return "cleanup";
  }
  if (text.includes("compress") || text.includes("level") || text.includes("vca") || text.includes("opto")) {
    return "dynamics";
  }
  if (text.includes("deess") || text.includes("de-ess") || text.includes("sibilance")) {
    return "deessing";
  }
  if (text.includes("eq") || text.includes("saturation") || text.includes("air") || text.includes("presence")) {
    return "tone";
  }
  return "inserts";
}

function buildMainSections(nodes: VisualNode[]): MainSection[] {
  const sections = new Map<string, VisualNode[]>();
  const order = ["cleanup", "tone", "dynamics", "deessing", "inserts"];

  nodes.forEach((node) => {
    const key = classifyMainSection(node.step);
    sections.set(key, [...(sections.get(key) ?? []), node]);
  });

  return order
    .filter((key) => (sections.get(key)?.length ?? 0) > 0)
    .map((key, index) => ({
      key,
      label: MAIN_SECTION_LABELS[key] ?? key,
      index: index + 1,
      nodes: sections.get(key) ?? [],
    }));
}

function nodeId(step: ChainStep) {
  return `step-${step.step}-${step.role ?? step.tool}`;
}

function centerX(rect: NodeRect) {
  return rect.left + rect.width / 2;
}

function centerY(rect: NodeRect) {
  return rect.top + rect.height / 2;
}

function buildMainPath(from: NodeRect, to: NodeRect) {
  const startX = centerX(from);
  const startY = from.top + from.height;
  const endX = centerX(to);
  const endY = to.top;
  const midY = startY + (endY - startY) / 2;

  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
}

function roundedOrthogonalPath(points: Array<[number, number]>, radius = 14) {
  if (points.length < 2) return "";

  const [startX, startY] = points[0];
  const parts = [`M ${startX} ${startY}`];

  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index];
    const next = points[index + 1];

    if (!next) {
      parts.push(`L ${x} ${y}`);
      continue;
    }

    const [previousX, previousY] = points[index - 1];
    const [nextX, nextY] = next;
    const incomingX = x - previousX;
    const incomingY = y - previousY;
    const outgoingX = nextX - x;
    const outgoingY = nextY - y;

    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);

    if (cornerRadius <= 0) {
      parts.push(`L ${x} ${y}`);
      continue;
    }

    const beforeX = x - (incomingX / incomingLength) * cornerRadius;
    const beforeY = y - (incomingY / incomingLength) * cornerRadius;
    const afterX = x + (outgoingX / outgoingLength) * cornerRadius;
    const afterY = y + (outgoingY / outgoingLength) * cornerRadius;

    parts.push(`L ${beforeX} ${beforeY}`);
    parts.push(`Q ${x} ${y} ${afterX} ${afterY}`);
  }

  return parts.join(" ");
}

function buildBranchPath(from: NodeRect, to: NodeRect) {
  const startX = from.left + from.width;
  const endX = to.left;
  const endY = centerY(to);
  const startY = centerY(from);
  const firstGutterX = startX + 16;
  const busGutterX = Math.max(firstGutterX + 18, endX - 24);

  return roundedOrthogonalPath([
    [startX, startY],
    [firstGutterX, startY],
    [firstGutterX, endY],
    [busGutterX, endY],
    [endX, endY],
  ]);
}

function findBranchAnchor(branch: VisualNode, mainNodes: VisualNode[]) {
  if (branch.step.sendPoint === "after-compressor-primary") {
    return (
      mainNodes.find((node) => node.step.role === "compressor_primary") ??
      mainNodes[0] ??
      null
    );
  }

  return mainNodes[mainNodes.length - 1] ?? null;
}

function normalizeGenre(value?: string): GenreName {
  if (value && value in GENRE_PROFILES) return value as GenreName;
  return getGenreName(value ?? "hip hop");
}

function normalizeDaw(value?: string): DawName {
  if (value && value in DAW_PLUGINS) return value as DawName;

  const lower = (value ?? "").toLowerCase();
  if (lower.includes("fl")) return "FL Studio";
  if (lower.includes("ableton")) return "Ableton Live";
  if (lower.includes("pro tools")) return "Pro Tools";
  return "Logic Pro";
}

function pluginName(pluginType: string, daw?: string) {
  const dawName = normalizeDaw(daw);
  const plugins = DAW_PLUGINS[dawName] as Record<string, string>;
  return plugins[pluginType] ?? humanize(pluginType);
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renumberChain(chain: ChainStep[]) {
  return chain.map((step, index) => ({ ...step, step: index + 1 }));
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatHz(value: number) {
  if (value >= 1000) {
    const khz = value / 1000;
    return `${khz >= 10 ? round(khz, 0) : round(khz, 1)} kHz`;
  }

  return `${Math.round(value)} Hz`;
}

function formatDb(value: number) {
  return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : round(value)} dB`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : `${round(value, 2)}`;
}

function numberParam(
  key: string,
  label: string,
  value: number,
  unit: NumberParam["unit"],
  min: number,
  max: number,
  step: number
): NumberParam {
  return { kind: "number", key, label, value, unit, min, max, step };
}

function selectParam(
  key: string,
  label: string,
  value: string,
  options: string[]
): SelectParam {
  return { kind: "select", key, label, value, options };
}

function toggleParam(key: string, label: string, value: boolean): ToggleParam {
  return { kind: "toggle", key, label, value };
}

function readNumber(action: string, pattern: RegExp, fallback: number) {
  const match = action.match(pattern);
  if (!match?.[1]) return fallback;

  const value = Number(match[1].replace("−", "-"));
  return Number.isFinite(value) ? value : fallback;
}

function readFrequency(action: string, pattern: RegExp, fallback: number) {
  const match = action.match(pattern);
  if (!match?.[1]) return fallback;

  const value = Number(match[1].replace("−", "-"));
  if (!Number.isFinite(value)) return fallback;

  return match[2]?.toLowerCase() === "khz" ? value * 1000 : value;
}

function replaceOrAppend(action: string, pattern: RegExp, replacement: string) {
  return pattern.test(action) ? action.replace(pattern, replacement) : `${action}, ${replacement}`;
}

function genericParams(step: ChainStep) {
  const params: ParamControl[] = [];
  const seen = new Set<string>();
  const token =
    /([A-Za-z][A-Za-z -]{0,24})?\s*([+\-−]?\d+(?:\.\d+)?)\s*(dB|Hz|kHz|ms|s|%|\/100)/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = token.exec(step.action)) && params.length < 6) {
    const rawUnit = match[3];
    const value = Number(match[2].replace("−", "-"));
    if (!Number.isFinite(value)) continue;

    const unit = rawUnit === "kHz" ? "Hz" : rawUnit === "/100" ? "%" : rawUnit;
    if (unit !== "dB" && unit !== "Hz" && unit !== "ms" && unit !== "s" && unit !== "%") {
      continue;
    }

    const label =
      match[1]?.trim().replace(/^,/, "") ||
      (unit === "Hz" ? "Frequency" : `Value ${params.length + 1}`);
    const key = `generic:${index}:${rawUnit}`;
    if (!seen.has(key)) {
      params.push(
        numberParam(
          key,
          humanize(label.toLowerCase()),
          rawUnit === "kHz" ? value * 1000 : value,
          unit,
          unit === "Hz" ? 20 : unit === "dB" ? -70 : 0,
          unit === "Hz" ? 20000 : unit === "dB" ? 20 : 100,
          unit === "Hz" ? 10 : 0.1
        )
      );
      seen.add(key);
    }
    index += 1;
  }

  return params;
}

function getStepParams(step: ChainStep): ParamControl[] {
  const role = step.role ?? "";
  const action = step.action;

  if (role === "gate") {
    return [
      numberParam("threshold_db", "Threshold", readNumber(action, /Threshold\s+([+\-−]?\d+(?:\.\d+)?)\s*dB/i, -45), "dB", -70, -20, 0.5),
      numberParam("attack_ms", "Attack", readNumber(action, /attack\s+([+\-−]?\d+(?:\.\d+)?)\s*ms/i, 3), "ms", 0.1, 50, 0.1),
      numberParam("release_ms", "Release", readNumber(action, /release\s+([+\-−]?\d+(?:\.\d+)?)\s*ms/i, 100), "ms", 20, 500, 1),
    ];
  }

  if (role === "highpass" || role === "lowpass") {
    return [
      numberParam("frequency_hz", "Frequency", readFrequency(action, /(?:at|pass at)\s+([+\-−]?\d+(?:\.\d+)?)\s*(kHz|Hz)/i, role === "lowpass" ? 18000 : 100), "Hz", 40, 20000, 10),
      selectParam("slope", "Slope", action.includes("24dB/oct") ? "24dB/oct" : "12dB/oct", SLOPE_OPTIONS),
    ];
  }

  if (role === "subtractive_eq" || role === "additive_eq" || role === "notch_filter" || role === "air_eq") {
    return eqParams(action, role);
  }

  if (
    role === "compressor_primary" ||
    role === "compressor_vca" ||
    role === "compressor_optical" ||
    role === "compressor_vari_mu" ||
    role === "parallel_comp_bus" ||
    role === "mastering_bus_comp"
  ) {
    const firstToken = action.split(",")[0]?.trim() ?? "VCA_SSL";
    const ratio = action.match(/(?:^|,\s*)(all-buttons|[\d.]+:1)(?:,|$)/i)?.[1] ?? "4:1";
    const params: ParamControl[] = [
      selectParam("ratio", "Ratio", ratio, RATIO_OPTIONS),
      numberParam("attack_ms", "Attack", readNumber(action, /attack\s+([+\-−]?\d+(?:\.\d+)?)\s*ms/i, 10), "ms", 0.1, 60, 0.1),
    ];

    if (role !== "parallel_comp_bus") {
      params.unshift(selectParam("style", "Style", firstToken, COMP_STYLE_OPTIONS));
      params.push(
        numberParam("release_ms", "Release", readNumber(action, /release\s+([+\-−]?\d+(?:\.\d+)?)\s*ms/i, 80), "ms", 20, 800, 1)
      );
    }

    if (action.toLowerCase().includes("threshold")) {
      params.push(numberParam("threshold_db", "Threshold", readNumber(action, /threshold\s+([+\-−]?\d+(?:\.\d+)?)\s*dB/i, -24), "dB", -45, -8, 0.5));
    }

    if (action.toLowerCase().includes("blend")) {
      params.push(numberParam("blend_percent", "Blend", readNumber(action, /blend\s+([+\-−]?\d+(?:\.\d+)?)%/i, 20), "%", 0, 50, 1));
    }

    if (action.toLowerCase().includes("gr")) {
      params.push(numberParam("gain_reduction_db", "Gain reduction", readNumber(action, /([+\-−]?\d+(?:\.\d+)?)\s*dB\s*GR/i, 3), "dB", 0, 12, 0.5));
    }

    return params;
  }

  if (role === "compressor_secondary") {
    return genericParams(step);
  }

  if (role === "deesser") {
    return [
      numberParam("frequency_hz", "Target", readFrequency(action, /Target\s+([+\-−]?\d+(?:\.\d+)?)\s*(kHz|Hz)/i, 7000), "Hz", 4000, 10000, 50),
      numberParam("reduction_db", "Reduction", readNumber(action, /reduce\s+([+\-−]?\d+(?:\.\d+)?)\s*dB/i, 4), "dB", 0, 10, 0.5),
    ];
  }

  if (role === "saturation" || role === "tape_saturation" || role === "tube_saturation" || role === "exciter") {
    return [
      numberParam("drive", "Drive", readNumber(action, /Drive\s+([+\-−]?\d+(?:\.\d+)?)\/100/i, 8), "%", 0, 60, 1),
      numberParam("mix_percent", "Mix", readNumber(action, /mix\s+([+\-−]?\d+(?:\.\d+)?)%/i, 8), "%", 0, 40, 1),
    ];
  }

  if (role === "reverb_bus_reverb" || role === "short_reverb" || role === "long_reverb") {
    return [
      numberParam("decay_s", "Decay", readNumber(action, /decay\s+([+\-−]?\d+(?:\.\d+)?)\s*s/i, 0.8), "s", 0.1, 4, 0.05),
      numberParam("pre_delay_ms", "Pre-delay", readNumber(action, /pre-delay\s+([+\-−]?\d+(?:\.\d+)?)\s*ms/i, 20), "ms", 0, 100, 1),
      numberParam("mix_percent", "Mix", readNumber(action, /mix\s+([+\-−]?\d+(?:\.\d+)?)%/i, 12), "%", 0, 45, 1),
    ];
  }

  if (role === "reverb_bus_comp") {
    return [
      toggleParam("sidechained", "Sidechained", action.toLowerCase().includes("sidechain")),
      numberParam("threshold_db", "Threshold", readNumber(action, /threshold\s+([+\-−]?\d+(?:\.\d+)?)\s*dB/i, -24), "dB", -45, -8, 1),
      selectParam("ratio", "Ratio", action.match(/ratio\s+([^\s,]+)/i)?.[1] ?? "4:1", RATIO_OPTIONS),
    ];
  }

  if (role === "delay_bus" || role === "slap_delay" || role === "rhythmic_delay") {
    return [
      selectParam("time", "Time", action.match(/^([^,\s]+(?:\s+dotted)?)/i)?.[1] ?? "1/8", TIME_OPTIONS),
      numberParam("feedback_percent", "Feedback", readNumber(action, /feedback\s+([+\-−]?\d+(?:\.\d+)?)%/i, 18), "%", 0, 65, 1),
      numberParam("mix_percent", "Mix", readNumber(action, /mix\s+([+\-−]?\d+(?:\.\d+)?)%/i, 10), "%", 0, 35, 1),
    ];
  }

  if (role === "width_bus" || role === "chorus") {
    return [
      selectParam("width_style", "Style", action.split(" width")[0]?.trim() || "chorus", WIDTH_STYLE_OPTIONS),
      numberParam("amount_percent", "Amount", readNumber(action, /amount\s+([+\-−]?\d+(?:\.\d+)?)%/i, 18), "%", 0, 55, 1),
    ];
  }

  if (role === "saturation_bus" || role === "distortion_bus") {
    return [
      selectParam("saturation_style", "Style", action.split(",")[0]?.trim() || "subtle tape warmth", SATURATION_STYLE_OPTIONS),
      numberParam(role === "distortion_bus" ? "blend_percent" : "mix_percent", role === "distortion_bus" ? "Blend" : "Mix", readNumber(action, /(?:blend|mix)\s+([+\-−]?\d+(?:\.\d+)?)%/i, 8), "%", 0, 35, 1),
    ];
  }

  if (role === "mastering_limiter" || role === "limiter") {
    return [
      numberParam("ceiling_db", "Ceiling", readNumber(action, /Ceiling\s+([+\-−]?\d+(?:\.\d+)?)\s*dB/i, -0.3), "dB", -3, 0, 0.1),
    ];
  }

  return genericParams(step);
}

function eqParams(action: string, role: string): ParamControl[] {
  const segments = action.split(";").map((segment) => segment.trim()).filter(Boolean);
  const params: ParamControl[] = [];

  segments.forEach((segment, index) => {
    if (role === "additive_eq") {
      params.push(
        selectParam(
          `eq:${index}:type`,
          `Band ${index + 1} type`,
          segment.toLowerCase().startsWith("shelf") ? "Shelf" : "Boost",
          ["Boost", "Shelf"]
        )
      );
    }

    params.push(
      numberParam(
        `eq:${index}:gain_db`,
        `Band ${index + 1} gain`,
        readNumber(segment, /([+\-−]?\d+(?:\.\d+)?)\s*dB/i, role === "additive_eq" ? 2 : -3),
        "dB",
        -12,
        8,
        0.5
      ),
      numberParam(
        `eq:${index}:frequency_hz`,
        `Band ${index + 1} freq`,
        readFrequency(segment, /at\s+([+\-−]?\d+(?:\.\d+)?)\s*(kHz|Hz)/i, 3000),
        "Hz",
        20,
        20000,
        10
      ),
      numberParam(
        `eq:${index}:q`,
        `Band ${index + 1} Q`,
        readNumber(segment, /Q\s+([+\-−]?\d+(?:\.\d+)?)/i, 1.2),
        "Q",
        0.2,
        10,
        0.1
      )
    );
  });

  return params.length > 0 ? params : genericParams({ step: 0, tool: "", action, reason: "" });
}

function updateEqAction(action: string, key: string, value: number | string) {
  const [, rawIndex, field] = key.split(":");
  const index = Number(rawIndex);
  const segments = action.split(";").map((segment) => segment.trim()).filter(Boolean);
  const current = segments[index] ?? "";

  if (!current) return action;

  if (field === "type" && typeof value === "string") {
    segments[index] = current.replace(/^(Boost|Shelf)/i, value);
  } else if (field === "gain_db" && typeof value === "number") {
    segments[index] = replaceOrAppend(current, /[+\-−]?\d+(?:\.\d+)?\s*dB/i, formatDb(value));
  } else if (field === "frequency_hz" && typeof value === "number") {
    segments[index] = replaceOrAppend(current, /at\s+[+\-−]?\d+(?:\.\d+)?\s*(?:kHz|Hz)/i, `at ${formatHz(value)}`);
  } else if (field === "q" && typeof value === "number") {
    segments[index] = replaceOrAppend(current, /Q\s+[+\-−]?\d+(?:\.\d+)?/i, `Q ${formatNumber(value)}`);
  }

  return segments.join("; ");
}

function updateGenericAction(action: string, key: string, value: number) {
  const [, rawIndex, rawUnit] = key.split(":");
  const targetIndex = Number(rawIndex);
  const token =
    /([+\-−]?\d+(?:\.\d+)?)\s*(dB|Hz|kHz|ms|s|%|\/100)/g;
  let index = 0;

  return action.replace(token, (match, _number, unit) => {
    if (index !== targetIndex) {
      index += 1;
      return match;
    }

    index += 1;
    if (rawUnit === "kHz") return `${formatNumber(value / 1000)} kHz`;
    if (unit === "/100") return `${formatNumber(value)}/100`;
    if (unit === "dB") return formatDb(value);
    if (unit === "Hz") return formatHz(value);
    return `${formatNumber(value)}${unit === "%" ? "%" : ` ${unit}`}`;
  });
}

function updateStepParam(step: ChainStep, key: string, value: number | string | boolean): ChainStep {
  const role = step.role ?? "";
  let action = step.action;

  if (key.startsWith("eq:") && (typeof value === "number" || typeof value === "string")) {
    return { ...step, action: updateEqAction(action, key, value) };
  }

  if (key.startsWith("generic:") && typeof value === "number") {
    return { ...step, action: updateGenericAction(action, key, value) };
  }

  if (key === "threshold_db" && typeof value === "number") {
    action = replaceOrAppend(action, /threshold\s+[+\-−]?\d+(?:\.\d+)?\s*dB/i, `threshold ${formatDb(value)}`);
    action = action.replace(/^threshold/i, "Threshold");
  }

  if (key === "attack_ms" && typeof value === "number") {
    action = replaceOrAppend(action, /attack\s+[+\-−]?\d+(?:\.\d+)?\s*ms/i, `attack ${formatNumber(value)} ms`);
  }

  if (key === "release_ms" && typeof value === "number") {
    action = replaceOrAppend(action, /release\s+[+\-−]?\d+(?:\.\d+)?\s*ms/i, `release ${formatNumber(value)} ms`);
  }

  if (key === "frequency_hz" && typeof value === "number") {
    if (role === "deesser") {
      action = replaceOrAppend(action, /Target\s+[+\-−]?\d+(?:\.\d+)?\s*(?:kHz|Hz)/i, `Target ${formatHz(value)}`);
    } else if (role === "lowpass") {
      action = replaceOrAppend(action, /Low-pass at\s+[+\-−]?\d+(?:\.\d+)?\s*(?:kHz|Hz)/i, `Low-pass at ${formatHz(value)}`);
    } else {
      action = replaceOrAppend(action, /High-pass at\s+[+\-−]?\d+(?:\.\d+)?\s*(?:kHz|Hz)/i, `High-pass at ${formatHz(value)}`);
    }
  }

  if (key === "slope" && typeof value === "string") {
    action = replaceOrAppend(action, /(12dB\/oct|24dB\/oct)/i, value);
  }

  if (key === "style" && typeof value === "string") {
    action = action.includes(",") ? action.replace(/^[^,]+/, value) : `${value}, ${action}`;
  }

  if (key === "ratio" && typeof value === "string") {
    if (role === "reverb_bus_comp") {
      action = replaceOrAppend(action, /ratio\s+[^\s,]+/i, `ratio ${value}`);
    } else {
      action = action.match(/(?:^|,\s*)(all-buttons|[\d.]+:1)(?:,|$)/i)
        ? action.replace(/(^|,\s*)(all-buttons|[\d.]+:1)(?=,|$)/i, `$1${value}`)
        : `${value}, ${action}`;
    }
  }

  if (key === "gain_reduction_db" && typeof value === "number") {
    action = replaceOrAppend(action, /[+\-−]?\d+(?:\.\d+)?\s*dB\s*GR/i, `${formatDb(value)} GR`);
  }

  if (key === "reduction_db" && typeof value === "number") {
    action = replaceOrAppend(action, /reduce\s+[+\-−]?\d+(?:\.\d+)?\s*dB/i, `reduce ${formatDb(value)}`);
  }

  if (key === "drive" && typeof value === "number") {
    action = replaceOrAppend(action, /Drive\s+[+\-−]?\d+(?:\.\d+)?\/100/i, `Drive ${formatNumber(value)}/100`);
  }

  if (key === "mix_percent" && typeof value === "number") {
    action = replaceOrAppend(action, /mix\s+[+\-−]?\d+(?:\.\d+)?%/i, `mix ${formatNumber(value)}%`);
  }

  if (key === "decay_s" && typeof value === "number") {
    action = replaceOrAppend(action, /decay\s+[+\-−]?\d+(?:\.\d+)?\s*s/i, `decay ${formatNumber(value)} s`);
  }

  if (key === "pre_delay_ms" && typeof value === "number") {
    action = replaceOrAppend(action, /pre-delay\s+[+\-−]?\d+(?:\.\d+)?\s*ms/i, `pre-delay ${formatNumber(value)} ms`);
  }

  if (key === "sidechained" && typeof value === "boolean") {
    action = action.replace(/^(Sidechain duck|Static return)/i, value ? "Sidechain duck" : "Static return");
    if (!/^(Sidechain duck|Static return)/i.test(action)) {
      action = `${value ? "Sidechain duck" : "Static return"}, ${action}`;
    }
  }

  if (key === "time" && typeof value === "string") {
    action = action.replace(/^([^,\s]+(?:\s+dotted)?)/i, value);
  }

  if (key === "feedback_percent" && typeof value === "number") {
    action = replaceOrAppend(action, /feedback\s+[+\-−]?\d+(?:\.\d+)?%/i, `feedback ${formatNumber(value)}%`);
  }

  if (key === "blend_percent" && typeof value === "number") {
    action = replaceOrAppend(action, /blend\s+[+\-−]?\d+(?:\.\d+)?%/i, `blend ${formatNumber(value)}%`);
  }

  if (key === "amount_percent" && typeof value === "number") {
    action = replaceOrAppend(action, /amount\s+[+\-−]?\d+(?:\.\d+)?%/i, `amount ${formatNumber(value)}%`);
  }

  if (key === "width_style" && typeof value === "string") {
    action = action.includes(" width")
      ? action.replace(/^[^,]+? width/i, `${value} width`)
      : `${value} width, ${action}`;
  }

  if (key === "saturation_style" && typeof value === "string") {
    action = action.includes(",") ? action.replace(/^[^,]+/, value) : `${value}, ${action}`;
  }

  if (key === "ceiling_db" && typeof value === "number") {
    action = replaceOrAppend(action, /Ceiling\s+[+\-−]?\d+(?:\.\d+)?\s*dB/i, `Ceiling ${formatDb(value)}`);
  }

  return { ...step, action };
}

function busSendPoint(target: AddTarget): ChainStep["sendPoint"] | undefined {
  if (target === "main") return undefined;
  if (target === "parallel_comp_bus") return "after-compressor-primary";
  if (target === "mastering_bus") return "return";
  return "post-chain";
}

function createPluginStep(
  pluginType: PalettePlugin,
  target: AddTarget,
  currentGenre?: string,
  currentDaw?: string
): ChainStep {
  const genre = normalizeGenre(currentGenre);
  const profile = GENRE_PROFILES[genre];
  const plugin = pluginName(pluginType, currentDaw);
  const sendPoint = busSendPoint(target);
  const base: Omit<ChainStep, "action"> = {
    step: 0,
    bus: target,
    role: pluginType,
    tool: plugin,
    reason: `Inserted in edit mode from the ${genre} baseline and ready for evaluation.`,
    ...(sendPoint ? { sendPoint } : {}),
  };

  const firstCut = profile.eq.subtractive[0] ?? { frequency: 350, gain_db: -3, q: 1.4 };
  const firstBoost = profile.eq.additive[0] ?? {
    frequency: 3000,
    gain_db: 2,
    q: 1,
    type: "bell" as const,
  };

  switch (pluginType) {
    case "gate":
      return {
        ...base,
        action: `Threshold ${formatDb(profile.gate.threshold_db)}, attack ${profile.gate.attack_ms} ms, release ${profile.gate.release_ms} ms`,
      };
    case "highpass":
      return {
        ...base,
        action: `High-pass at ${formatHz(profile.eq.highpass_hz)}, ${profile.eq.highpass_hz >= 110 ? "24dB/oct" : "12dB/oct"}`,
      };
    case "lowpass":
      return { ...base, action: "Low-pass at 18 kHz, 12dB/oct" };
    case "notch_filter":
      return {
        ...base,
        action: `${formatDb(-3)} at ${formatHz(firstCut.frequency)}, Q 6`,
      };
    case "subtractive_eq":
      return {
        ...base,
        action: profile.eq.subtractive
          .map((cut) => `${formatDb(cut.gain_db)} at ${formatHz(cut.frequency)}, Q ${cut.q}`)
          .join("; "),
      };
    case "additive_eq":
      return {
        ...base,
        action: profile.eq.additive
          .map((boost) => `${boost.type === "shelf" ? "Shelf" : "Boost"} ${formatDb(boost.gain_db)} at ${formatHz(boost.frequency)}, Q ${boost.q}`)
          .join("; "),
      };
    case "air_eq":
      return {
        ...base,
        action: `Shelf ${formatDb(Math.max(1, firstBoost.gain_db))} at 12 kHz, Q 0.7`,
      };
    case "tilt_eq":
      return { ...base, action: "Tilt +1 dB bright, pivot 1 kHz" };
    case "compressor_vca":
      return {
        ...base,
        action: `VCA_SSL, ${profile.compression.primary.ratio}, attack ${profile.compression.primary.attack_ms} ms, release ${profile.compression.primary.release_ms} ms, threshold ${formatDb(profile.compression.primary.threshold_db)}, ${formatDb(profile.compression.primary.gain_reduction_db)} GR`,
      };
    case "compressor_optical":
      return {
        ...base,
        action: `OPTICAL_LA2A, 3:1, attack 10 ms, release 600 ms, threshold ${formatDb(profile.compression.primary.threshold_db + 3)}, ${formatDb(3)} GR`,
      };
    case "compressor_vari_mu":
      return {
        ...base,
        action: `TUBE_CL1B, 2:1, attack 25 ms, release 180 ms, threshold ${formatDb(profile.compression.primary.threshold_db + 4)}, ${formatDb(2)} GR`,
      };
    case "limiter":
      return { ...base, action: "Ceiling -0.3 dB" };
    case "transient_shaper":
      return { ...base, action: "Attack +5%, sustain -5%, mix 45%" };
    case "deesser":
      return {
        ...base,
        action: `Target ${formatHz(profile.deesser.frequency)}, reduce ${formatDb(profile.deesser.reduction_db)}`,
      };
    case "pitch_correction":
      return { ...base, action: "Speed 35 ms, amount 35%, formant 0%" };
    case "noise_reduction":
      return { ...base, action: "Reduction 6 dB, sensitivity 25%, mix 70%" };
    case "saturation":
      return {
        ...base,
        action: `Drive ${Math.max(2, profile.saturation.drive)}/100, mix ${Math.max(4, profile.saturation.mix_percent)}%`,
      };
    case "tape_saturation":
      return { ...base, action: "Drive 6/100, mix 8%" };
    case "tube_saturation":
      return { ...base, action: "Drive 5/100, mix 7%" };
    case "exciter":
      return { ...base, action: "Drive 3/100, mix 6%" };
    case "short_reverb":
      return {
        ...base,
        action: `${profile.buses.reverb.character}, decay ${Math.min(profile.buses.reverb.decay_s, 0.8)} s, pre-delay ${profile.buses.reverb.pre_delay_ms} ms, mix ${Math.min(profile.buses.reverb.mix_percent, 14)}%`,
      };
    case "long_reverb":
      return {
        ...base,
        action: `${profile.buses.reverb.character}, decay ${Math.max(profile.buses.reverb.decay_s, 1.4)} s, pre-delay ${profile.buses.reverb.pre_delay_ms} ms, mix ${profile.buses.reverb.mix_percent}%`,
      };
    case "slap_delay":
      return { ...base, action: "1/16 note, feedback 8%, mix 6%" };
    case "rhythmic_delay":
      return {
        ...base,
        action: `${profile.buses.delay.time} note, feedback ${profile.buses.delay.feedback_percent}%, mix ${profile.buses.delay.mix_percent}%`,
      };
    case "chorus":
      return {
        ...base,
        action: `${profile.buses.width?.style ?? "chorus"} width, amount ${profile.buses.width?.amount_percent ?? 12}%`,
      };
    default:
      return { ...base, action: "Mix 5%" };
  }
}

function severityClass(severity: EvaluationSeverity) {
  if (severity === "critical") return styles.nodeShellCritical;
  if (severity === "warning") return styles.nodeShellWarning;
  return styles.nodeShellSuggestion;
}

export function VisualVocalChain({
  chain,
  engineerNote,
  mode = "view",
  isDirty = false,
  hasUnsavedChanges = false,
  evaluating = false,
  evaluationResult = null,
  feedbackPanelOpen = false,
  displayedMeasuredFit,
  currentGenre,
  currentDaw,
  measuredFit,
  assistantHighlight = null,
  audioPulse = 0,
  onEnterEditMode,
  onEditedChainChange,
  onEvaluate,
  onConfirmSave,
  onDiscard,
  onFeedbackPanelOpenChange,
}: VisualVocalChainProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const [nodeRects, setNodeRects] = useState<Record<string, NodeRect>>({});
  const [paths, setPaths] = useState<WirePath[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [expandedBus, setExpandedBus] = useState<BusKind | null>(null);
  const [highlightedNode, setHighlightedNode] = useState<{
    id: string;
    severity: EvaluationSeverity;
  } | null>(null);
  const isEditMode = mode === "edit";
  const busesExpanded = true;
  const activeEditNodeId = isEditMode ? editNodeId : null;
  const activeConfirmRemoveId = isEditMode ? confirmRemoveId : null;
  const activeAddTarget = isEditMode ? addTarget : null;

  const nodes = useMemo<VisualNode[]>(() => {
    if (!chain?.length) return [];

    return chain.map((step) => ({
      id: nodeId(step),
      step,
      kind: classifyStep(step),
    }));
  }, [chain]);

  const { mainNodes, branchGroups } = useMemo(() => {
    const main = nodes.filter((node) => node.kind === "main");
    const branches = nodes.filter((node) => node.kind !== "main");
    const groups = BUS_ORDER.reduce<Record<BusKind, VisualNode[]>>(
      (acc, kind) => ({ ...acc, [kind]: [] }),
      {
        reverb_bus: [],
        delay_bus: [],
        parallel_comp_bus: [],
        width_bus: [],
        saturation_bus: [],
        distortion_bus: [],
        mastering_bus: [],
      }
    );

    branches.forEach((node) => {
      groups[node.kind as BusKind].push(node);
    });

    if (main.length > 0 || nodes.length === 0) {
      return { mainNodes: main, branchGroups: groups };
    }

    return {
      mainNodes: [nodes[0]],
      branchGroups: BUS_ORDER.reduce<Record<BusKind, VisualNode[]>>(
        (acc, kind) => ({
          ...acc,
          [kind]: kind === "reverb_bus" ? nodes.slice(1) : [],
        }),
        groups
      ),
    };
  }, [nodes]);

  const mainSections = useMemo(() => buildMainSections(mainNodes), [mainNodes]);

  useEffect(() => {
    if (!activeEditNodeId) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editPanelRef.current?.contains(target)) return;
      if (target.closest(`[data-node-id="${activeEditNodeId}"]`)) return;

      setEditNodeId(null);
      setConfirmRemoveId(null);
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [activeEditNodeId]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateRects = () => {
      if (!containerRef.current) return;

      const containerBounds = containerRef.current.getBoundingClientRect();
      const elements = Array.from(
        containerRef.current.querySelectorAll("[data-node-id]")
      );
      const nextRects: Record<string, NodeRect> = {};

      elements.forEach((element) => {
        const id = element.getAttribute("data-node-id");
        if (!id) return;

        const rect = element.getBoundingClientRect();
        nextRects[id] = {
          id,
          left: rect.left - containerBounds.left,
          top: rect.top - containerBounds.top,
          width: rect.width,
          height: rect.height,
        };
      });

      setNodeRects(nextRects);
    };

    updateRects();

    const observer = new ResizeObserver(updateRects);
    observer.observe(containerRef.current);
    containerRef.current
      .querySelectorAll("[data-node-id]")
      .forEach((element) => observer.observe(element));

    const scrollTargets = Array.from(
      containerRef.current.querySelectorAll("[data-scroll-sync]")
    );
    scrollTargets.forEach((element) =>
      element.addEventListener("scroll", updateRects, { passive: true })
    );

    const timer = setTimeout(updateRects, 120);

    return () => {
      observer.disconnect();
      scrollTargets.forEach((element) =>
        element.removeEventListener("scroll", updateRects)
      );
      clearTimeout(timer);
    };
  }, [nodes, busesExpanded, feedbackPanelOpen, expandedBus]);

  useEffect(() => {
    const nextPaths: WirePath[] = [];
    const branchNodes = feedbackPanelOpen
      ? []
      : BUS_ORDER.flatMap((kind) => branchGroups[kind]);

    for (let index = 0; index < mainNodes.length - 1; index += 1) {
      const from = nodeRects[mainNodes[index].id];
      const to = nodeRects[mainNodes[index + 1].id];
      if (!from || !to) continue;

      nextPaths.push({
        id: `${mainNodes[index].id}-to-${mainNodes[index + 1].id}`,
        d: buildMainPath(from, to),
        sourceId: mainNodes[index].id,
        targetId: mainNodes[index + 1].id,
      });
    }

    branchNodes.forEach((branch) => {
      const anchor = findBranchAnchor(branch, mainNodes);
      if (!anchor) return;

      const from = nodeRects[anchor.id];
      const to = nodeRects[branch.id];
      if (!from || !to) return;

      nextPaths.push({
        id: `${anchor.id}-to-${branch.id}`,
        d: buildBranchPath(from, to),
        isBranch: true,
        sourceId: anchor.id,
        targetId: branch.id,
      });
    });

    const frame = requestAnimationFrame(() => setPaths(nextPaths));
    return () => cancelAnimationFrame(frame);
  }, [branchGroups, feedbackPanelOpen, mainNodes, nodeRects]);

  const updateChain = (nextChain: ChainStep[]) => {
    onEditedChainChange?.(renumberChain(nextChain));
  };

  const updateNode = (id: string, updater: (step: ChainStep) => ChainStep) => {
    if (!chain) return;
    updateChain(chain.map((step) => (nodeId(step) === id ? updater(step) : step)));
  };

  const handleParamChange = (
    node: VisualNode,
    param: ParamControl,
    value: number | string | boolean
  ) => {
    updateNode(node.id, (step) => updateStepParam(step, param.key, value));
  };

  const removeNode = (node: VisualNode) => {
    if (!chain) return;
    updateChain(chain.filter((step) => nodeId(step) !== node.id));
    setEditNodeId(null);
    setConfirmRemoveId(null);
  };

  const toggleNode = (node: VisualNode) => {
    updateNode(node.id, (step) => ({
      ...step,
      enabled: step.enabled === false,
    }));
  };

  const reorderWithinLane = (fromId: string, toId: string) => {
    if (!chain || fromId === toId) return;

    const fromStep = chain.find((step) => nodeId(step) === fromId);
    const toStep = chain.find((step) => nodeId(step) === toId);
    if (!fromStep || !toStep || classifyStep(fromStep) !== classifyStep(toStep)) return;

    const nextChain = [...chain];
    const fromIndex = nextChain.findIndex((step) => nodeId(step) === fromId);
    const toIndex = nextChain.findIndex((step) => nodeId(step) === toId);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = nextChain.splice(fromIndex, 1);
    nextChain.splice(toIndex, 0, moved);
    updateChain(nextChain);
  };

  const insertPlugin = (target: AddTarget, pluginType: PalettePlugin) => {
    if (!chain) return;

    const busIsInactive =
      target !== "main" &&
      branchGroups[target].length > 0 &&
      !branchGroups[target].some((node) => node.step.enabled !== false);
    const nextPlugin = {
      ...createPluginStep(pluginType, target, currentGenre, currentDaw),
      ...(busIsInactive ? { enabled: false } : {}),
    };

    if (target === "main") {
      const main = chain.filter((step) => classifyStep(step) === "main");
      const branches = chain.filter((step) => classifyStep(step) !== "main");
      updateChain([...main, nextPlugin, ...branches]);
      setAddTarget(null);
      return;
    }

    const nextChain = [...chain];
    let lastBusIndex = -1;
    for (let index = nextChain.length - 1; index >= 0; index -= 1) {
      if (classifyStep(nextChain[index]) === target) {
        lastBusIndex = index;
        break;
      }
    }

    if (lastBusIndex >= 0) {
      nextChain.splice(lastBusIndex + 1, 0, nextPlugin);
      updateChain(nextChain);
      setAddTarget(null);
      return;
    }

    const targetOrder = BUS_ORDER.indexOf(target);
    const nextBusIndex = nextChain.findIndex((step) => {
      const kind = classifyStep(step);
      return kind !== "main" && BUS_ORDER.indexOf(kind) > targetOrder;
    });

    nextChain.splice(nextBusIndex >= 0 ? nextBusIndex : nextChain.length, 0, nextPlugin);
    updateChain(nextChain);
    setAddTarget(null);
  };

  const toggleBus = (kind: BusKind) => {
    if (!chain) return;

    const group = branchGroups[kind];
    if (group.length === 0) return;
    const nextEnabled = !group.some((node) => node.step.enabled !== false);

    updateChain(
      chain.map((step) =>
        classifyStep(step) === kind ? { ...step, enabled: nextEnabled } : step
      )
    );
  };

  const findIssueNode = (plugin: string) => {
    const needle = plugin.toLowerCase();
    return (
      nodes.find((node) => (node.step.role ?? "").toLowerCase() === needle) ??
      nodes.find((node) => node.step.tool.toLowerCase() === needle) ??
      nodes.find((node) => node.step.tool.toLowerCase().includes(needle)) ??
      nodes.find((node) => (node.step.role ?? "").toLowerCase().includes(needle)) ??
      nodes.find((node) => `${node.step.action} ${node.step.reason}`.toLowerCase().includes(needle)) ??
      null
    );
  };

  const jumpToIssue = (issue: EvaluationIssue) => {
    const node = findIssueNode(issue.plugin);
    if (!node) return;

    setEditNodeId(node.id);
    setHighlightedNode({ id: node.id, severity: issue.severity });

    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-node-id="${node.id}"]`)
        ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    });
  };

  if (!chain?.length) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>Upload a vocal or skip to explore.</div>
      </div>
    );
  }

  const visibleBuses = isEditMode
    ? BUS_ORDER
    : BUS_ORDER.filter((kind) => branchGroups[kind].length > 0);
  const busRows = buildBusRows(visibleBuses);
  const orderedBuses = busRows.flat();
  const canEvaluate = isEditMode && isDirty && !evaluating;
  const canApply = isEditMode && hasUnsavedChanges && !evaluating;
  const showFitBadge =
    measuredFit === "good" || evaluationResult?.measured_fit === "good";

  return (
    <div
      className={`${styles.container} ${isEditMode ? styles.containerEdit : ""} ${
        showFitBadge ? styles.containerFitGood : ""
      }`}
      ref={containerRef}
      style={{ "--node-pulse": audioPulse } as CSSProperties}
    >
      <svg className={styles.svgLayer} width="100%" height="100%">
        {paths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            data-source-id={path.sourceId}
            data-target-id={path.targetId}
            className={`${styles.glowingPath} ${
              path.isBranch ? styles.branchWire : styles.mainWire
            } ${
              activeNodeId === path.sourceId || activeNodeId === path.targetId
                ? styles.activeWire
                : ""
            }`}
          />
        ))}
      </svg>

      <AnimatePresence>
        {showFitBadge && (
          <motion.div
            className={styles.fitStamp}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.2 }}
          >
            Measured fit
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`${styles.graph} ${feedbackPanelOpen ? styles.graphFeedbackOpen : ""} ${
          isEditMode ? styles.graphEdit : ""
        }`}
      >
        <section className={styles.mainColumn} data-scroll-sync>
          {engineerNote && (
            <p className={styles.engineerNote}>{engineerNote}</p>
          )}
          {mainSections.map((section) => (
            <div className={styles.mainSectionGroup} key={section.key}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIndex}>{section.index}</span>
                <span>{section.label}</span>
              </div>
              {section.nodes.map((node) => (
                <div className={styles.mainNodeSlot} key={node.id}>
                  <ChainNode
                    node={node}
                    delay={(node.step.step - 1) * 0.04}
                    active={activeNodeId === node.id}
                    editing={isEditMode}
                    editOpen={activeEditNodeId === node.id}
                    editPanelRef={activeEditNodeId === node.id ? editPanelRef : undefined}
                    confirmRemove={activeConfirmRemoveId === node.id}
	                    draggableNode={isEditMode}
                    highlightedClass={
                      assistantHighlight?.step === node.step.step
                        ? styles.nodeShellAiPulse
                        : highlightedNode?.id === node.id
                          ? severityClass(highlightedNode.severity)
                          : undefined
                    }
                    onActiveChange={setActiveNodeId}
                    onOpenEdit={() => {
                      if (!isEditMode) return;
                      setEditNodeId(node.id);
                      setConfirmRemoveId(null);
                    }}
	                    onParamChange={(param, value) => handleParamChange(node, param, value)}
	                    onToggleEnabled={() => toggleNode(node)}
	                    onRemove={() => removeNode(node)}
                    onRemoveIntent={() =>
                      setConfirmRemoveId((current) => (current === node.id ? null : node.id))
                    }
                    onDragStart={() => setDraggedNodeId(node.id)}
                    onDragEnd={() => setDraggedNodeId(null)}
                    onDragOver={(event) => {
                      if (!isEditMode || node.kind !== "main") return;
                      event.preventDefault();
                    }}
	                    onDrop={(event) => {
	                      event.preventDefault();
	                      if (draggedNodeId) reorderWithinLane(draggedNodeId, node.id);
	                      setDraggedNodeId(null);
	                    }}
                  />
                </div>
              ))}
            </div>
          ))}
          {isEditMode && (
            <AddPluginBar
              label="Add plugin to vocal chain"
              open={activeAddTarget === "main"}
              currentDaw={currentDaw}
              onOpen={() => setAddTarget((current) => (current === "main" ? null : "main"))}
              onClose={() => setAddTarget(null)}
              onSelect={(pluginType) => insertPlugin("main", pluginType)}
            />
          )}
        </section>

        {visibleBuses.length > 0 && (
          <>
            <AnimatePresence mode="wait">
              {feedbackPanelOpen && evaluationResult ? (
                <motion.section
                  key="feedback"
                  className={styles.feedbackColumn}
                  initial={{ opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 28 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <BusPills
                    buses={visibleBuses}
                    branchGroups={branchGroups}
                    expandedBus={expandedBus}
                    onExpand={(bus) =>
                      setExpandedBus((current) => (current === bus ? null : bus))
                    }
                  />
                  {expandedBus && (
                    <div className={styles.busOverlay}>
                      <div className={styles.busOverlayHeader}>
                        <span>{BUS_LABELS[expandedBus]}</span>
                        <button type="button" onClick={() => setExpandedBus(null)}>
                          x
                        </button>
                      </div>
                      {branchGroups[expandedBus].length > 0 ? (
                        branchGroups[expandedBus].map((node, index) => (
                          <ChainNode
                            key={node.id}
                            node={node}
                            branch
                            delay={index * 0.04}
                            active={activeNodeId === node.id}
                            editing={isEditMode}
	                            editOpen={activeEditNodeId === node.id}
	                            editPanelRef={activeEditNodeId === node.id ? editPanelRef : undefined}
	                            confirmRemove={activeConfirmRemoveId === node.id}
	                            draggableNode={isEditMode}
	                            highlightedClass={
                              assistantHighlight?.step === node.step.step
                                ? styles.nodeShellAiPulse
                                : highlightedNode?.id === node.id
                                ? severityClass(highlightedNode.severity)
                                : undefined
                            }
                            onActiveChange={setActiveNodeId}
                            onOpenEdit={() => {
                              setEditNodeId(node.id);
                              setConfirmRemoveId(null);
	                            }}
	                            onParamChange={(param, value) => handleParamChange(node, param, value)}
	                            onToggleEnabled={() => toggleNode(node)}
	                            onRemove={() => removeNode(node)}
                            onRemoveIntent={() =>
                              setConfirmRemoveId((current) =>
	                                current === node.id ? null : node.id
	                              )
	                            }
	                            onDragStart={() => setDraggedNodeId(node.id)}
	                            onDragEnd={() => setDraggedNodeId(null)}
	                            onDragOver={(event) => {
	                              if (!isEditMode) return;
	                              event.preventDefault();
	                            }}
	                            onDrop={(event) => {
	                              event.preventDefault();
	                              if (draggedNodeId) reorderWithinLane(draggedNodeId, node.id);
	                              setDraggedNodeId(null);
	                            }}
	                          />
                        ))
                      ) : (
                        <span className={styles.emptyBusText}>No plugin on this bus.</span>
                      )}
                      {isEditMode && (
                        <AddPluginBar
                          compact
                          label={`Add plugin to ${BUS_LABELS[expandedBus]}`}
                          open={activeAddTarget === expandedBus}
                          currentDaw={currentDaw}
                          onOpen={() =>
                            setAddTarget((current) =>
                              current === expandedBus ? null : expandedBus
                            )
                          }
                          onClose={() => setAddTarget(null)}
                          onSelect={(pluginType) => insertPlugin(expandedBus, pluginType)}
                        />
                      )}
                    </div>
                  )}
                  <FeedbackPanel
                    result={evaluationResult}
                    displayedMeasuredFit={displayedMeasuredFit}
                    isDirty={isDirty}
                    evaluating={evaluating}
                    onClose={() => onFeedbackPanelOpenChange?.(false)}
                    onEvaluate={onEvaluate}
                    onJump={jumpToIssue}
                  />
                </motion.section>
              ) : (
                <motion.section
                  key="buses"
                  className={`${styles.busScroller} ${
                    busesExpanded
                      ? styles.busScrollerExpanded
                      : styles.busScrollerCollapsed
                  }`}
                  data-scroll-sync
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -18 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className={styles.branchColumn}>
                    {busRows.map((row, rowIndex) => (
                      <div className={styles.branchRow} key={`bus-row-${rowIndex}`}>
                        {row.map((kind) => {
                          const group = branchGroups[kind];
                          const groupIndex = orderedBuses.indexOf(kind);
                          const busActive =
                            group.length === 0 ||
                            group.some((node) => node.step.enabled !== false);

                          return (
                            <div
                              className={`${styles.branchGroup} ${
                                group.length > 1 ? styles.branchGroupStacked : ""
                              } ${!busActive ? styles.branchGroupInactive : ""}`}
                              key={kind}
                            >
                              <div className={styles.branchHeader}>
                                <span className={styles.branchLabel}>
                                  <span className={styles.sectionIndex}>
                                    {mainSections.length + groupIndex + 1}
                                  </span>
                                  {BUS_LABELS[kind]}
                                </span>
                                <div className={styles.branchHeaderMeta}>
                                  {isEditMode && (
                                    <button
                                      type="button"
                                      className={`${styles.busPower} ${
                                        busActive ? styles.busPowerActive : ""
                                      }`}
                                      onClick={() => toggleBus(kind)}
                                      aria-label={`Toggle ${BUS_LABELS[kind]}`}
                                      disabled={group.length === 0}
                                    >
                                      <span />
                                    </button>
                                  )}
                                  {group.length > 1 && (
                                    <span className={styles.branchCount}>
                                      {group.length}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className={styles.branchStack}>
                                {group.length > 0 ? (
                                  group.map((node, index) => (
                                    <ChainNode
                                      key={node.id}
                                      node={node}
                                      branch
                                      delay={(groupIndex + index + mainNodes.length) * 0.08}
                                      active={activeNodeId === node.id}
                                      editing={isEditMode}
	                                      editOpen={activeEditNodeId === node.id}
	                                      editPanelRef={
	                                        activeEditNodeId === node.id ? editPanelRef : undefined
	                                      }
	                                      confirmRemove={activeConfirmRemoveId === node.id}
	                                      draggableNode={isEditMode}
	                                      highlightedClass={
                                        assistantHighlight?.step === node.step.step
                                          ? styles.nodeShellAiPulse
                                          : highlightedNode?.id === node.id
                                          ? severityClass(highlightedNode.severity)
                                          : undefined
                                      }
                                      onActiveChange={setActiveNodeId}
                                      onOpenEdit={() => {
                                        if (!isEditMode) return;
                                        setEditNodeId(node.id);
                                        setConfirmRemoveId(null);
                                      }}
	                                      onParamChange={(param, value) =>
	                                        handleParamChange(node, param, value)
	                                      }
	                                      onToggleEnabled={() => toggleNode(node)}
	                                      onRemove={() => removeNode(node)}
                                      onRemoveIntent={() =>
                                        setConfirmRemoveId((current) =>
	                                          current === node.id ? null : node.id
	                                        )
	                                      }
	                                      onDragStart={() => setDraggedNodeId(node.id)}
	                                      onDragEnd={() => setDraggedNodeId(null)}
	                                      onDragOver={(event) => {
	                                        if (!isEditMode) return;
	                                        event.preventDefault();
	                                      }}
	                                      onDrop={(event) => {
	                                        event.preventDefault();
	                                        if (draggedNodeId) reorderWithinLane(draggedNodeId, node.id);
	                                        setDraggedNodeId(null);
	                                      }}
	                                    />
                                  ))
                                ) : (
                                  <span className={styles.emptyBusText}>empty</span>
                                )}
                                {isEditMode && (
                                  <AddPluginBar
                                    compact
                                    label={`Add plugin to ${BUS_LABELS[kind]}`}
                                    open={activeAddTarget === kind}
                                    currentDaw={currentDaw}
                                    onOpen={() =>
                                      setAddTarget((current) =>
                                        current === kind ? null : kind
                                      )
                                    }
                                    onClose={() => setAddTarget(null)}
                                    onSelect={(pluginType) => insertPlugin(kind, pluginType)}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      <div className={styles.actionFooter}>
        <AnimatePresence mode="wait">
          {!isEditMode ? (
            <motion.div
              key="view-actions"
              className={styles.viewActions}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22 }}
            >
              <button
                type="button"
                className={styles.editChainButton}
                onClick={onEnterEditMode}
              >
                Edit Chain
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="edit-actions"
              className={styles.editActions}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.24, staggerChildren: 0.04 }}
            >
              <button
                type="button"
                className={styles.cancelEditButton}
                onClick={onDiscard}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.applyChangesButton} ${
                  canApply ? styles.applyChangesButtonActive : ""
                }`}
                disabled={!canApply}
                onClick={onConfirmSave}
              >
                Apply changes
              </button>
              <button
                type="button"
                className={`${styles.evaluateButton} ${
                  canEvaluate ? styles.evaluateButtonActive : ""
                } ${evaluating ? styles.evaluateButtonLoading : ""}`}
                disabled={!canEvaluate}
                onClick={onEvaluate}
              >
                {evaluating
                  ? "Analysing..."
                  : isDirty
                    ? "Evaluate chain ->"
                    : "Evaluate chain"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ChainNode({
  node,
  branch = false,
  delay,
  active,
  editing = false,
  editOpen = false,
  editPanelRef,
  confirmRemove = false,
  draggableNode = false,
  highlightedClass,
  onActiveChange,
  onOpenEdit,
	  onParamChange,
	  onToggleEnabled,
	  onRemoveIntent,
	  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  node: VisualNode;
  branch?: boolean;
  delay: number;
  active?: boolean;
  editing?: boolean;
  editOpen?: boolean;
  editPanelRef?: RefObject<HTMLDivElement | null>;
  confirmRemove?: boolean;
  draggableNode?: boolean;
  highlightedClass?: string;
  onActiveChange?: (id: string | null) => void;
	  onOpenEdit?: () => void;
	  onParamChange?: (param: ParamControl, value: number | string | boolean) => void;
	  onToggleEnabled?: () => void;
	  onRemoveIntent?: () => void;
	  onRemove?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const params = getStepParams(node.step);
  const inactive = node.step.enabled === false;

  return (
    <motion.div
      layout
      className={`${styles.nodeShell} ${active ? styles.nodeShellActive : ""} ${
        editing ? styles.nodeShellEditable : ""
      } ${inactive ? styles.nodeShellInactive : ""} ${highlightedClass ?? ""}`}
      data-node-id={node.id}
      onMouseEnter={() => onActiveChange?.(node.id)}
      onMouseLeave={() => onActiveChange?.(null)}
      onFocus={() => onActiveChange?.(node.id)}
      onBlur={() => onActiveChange?.(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ animationDelay: `${delay}s` }}
    >
      <div
        className={`${styles.node} ${branch ? styles.branchNode : ""}`}
        tabIndex={0}
        role={editing ? "button" : undefined}
        onClick={onOpenEdit}
      >
        {draggableNode && (
          <button
            type="button"
            className={styles.dragHandle}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", node.id);
              onDragStart?.();
            }}
            onDragEnd={onDragEnd}
            aria-label="Drag plugin"
            title="Drag plugin"
          >
            ⠿
          </button>
        )}
	        {editing ? (
	          <button
	            type="button"
	            className={`${styles.nodePower} ${
	              !inactive ? styles.nodePowerActive : ""
	            }`}
	            aria-label={inactive ? "Enable plugin" : "Disable plugin"}
	            aria-pressed={!inactive}
	            onClick={(event) => {
	              event.stopPropagation();
	              onToggleEnabled?.();
	            }}
	          >
	            <span />
	          </button>
	        ) : (
	          <button
	            type="button"
	            className={styles.nodeMenu}
	            aria-label="Plugin options"
	            onClick={(event) => event.stopPropagation()}
	          >
	            ...
	          </button>
	        )}
        <span className={styles.stepNumber}>{node.step.step}</span>
        <span className={styles.nodeLabel}>{node.step.tool}</span>
        <span className={styles.nodeAction} title={node.step.action}>
          {node.step.action}
        </span>
        {node.step.note && (
          <span className={styles.nodeNote}>{node.step.note}</span>
        )}
      </div>

      <AnimatePresence>
        {editing && editOpen && (
          <motion.div
            className={styles.editPanel}
            ref={editPanelRef}
            data-edit-panel
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className={styles.editPanelHeader}>
              <span>Plugin</span>
              <strong>{node.step.tool}</strong>
            </div>

            <div className={styles.paramList}>
              {params.length > 0 ? (
                params.map((param) => (
                  <ParamControlRow
                    key={param.key}
                    param={param}
                    onChange={(value) => onParamChange?.(param, value)}
                  />
                ))
              ) : (
                <span className={styles.noParams}>No editable parameters detected.</span>
              )}
            </div>

            <button
              type="button"
              className={`${styles.removeButton} ${
                confirmRemove ? styles.removeButtonConfirm : ""
              }`}
              onClick={confirmRemove ? onRemove : onRemoveIntent}
            >
              {confirmRemove ? "Confirm remove" : "Remove plugin"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ParamControlRow({
  param,
  onChange,
}: {
  param: ParamControl;
  onChange: (value: number | string | boolean) => void;
}) {
  if (param.kind === "toggle") {
    return (
      <label className={styles.paramRow}>
        <span className={styles.paramLabel}>{param.label}</span>
        <button
          type="button"
          className={`${styles.toggle} ${param.value ? styles.toggleActive : ""}`}
          onClick={() => onChange(!param.value)}
          aria-pressed={param.value}
        >
          <span />
        </button>
      </label>
    );
  }

  if (param.kind === "select") {
    return (
      <label className={styles.paramRow}>
        <span className={styles.paramLabel}>{param.label}</span>
        <select
          className={styles.selectControl}
          value={param.value}
          onChange={(event) => onChange(event.target.value)}
        >
          {param.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className={styles.paramRow}>
      <span className={styles.paramLabel}>{param.label}</span>
      <div className={styles.numberControl}>
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={clamp(param.value, param.min, param.max)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className={styles.numericInputWrap}>
          <input
            type="number"
            min={param.min}
            max={param.max}
            step={param.step}
            value={Number.isInteger(param.value) ? param.value : round(param.value, 2)}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <em>{param.unit}</em>
        </span>
      </div>
    </label>
  );
}

function AddPluginBar({
  label,
  compact = false,
  open,
  currentDaw,
  onOpen,
  onClose,
  onSelect,
}: {
  label: string;
  compact?: boolean;
  open: boolean;
  currentDaw?: string;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (pluginType: PalettePlugin) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || wrapRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose, open]);

  return (
    <div
      className={`${styles.addPluginWrap} ${compact ? styles.addPluginWrapCompact : ""}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className={`${styles.addPluginBar} ${open ? styles.addPluginBarOpen : ""}`}
        onClick={onOpen}
        aria-expanded={open}
      >
        <span>+</span>
        {label}
      </button>
      <AnimatePresence>
        {open && (
          <PluginPalette
            currentDaw={currentDaw}
            onSelect={onSelect}
            onClose={onClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PluginPalette({
  currentDaw,
  onSelect,
  onClose,
}: {
  currentDaw?: string;
  onSelect: (pluginType: PalettePlugin) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries = useMemo(() => {
    return (Object.entries(PLUGIN_PALETTE) as Array<[PaletteCategory, readonly PalettePlugin[]]>)
      .flatMap(([category, plugins]) =>
        plugins.map((pluginType) => ({
          category,
          pluginType,
          label: humanize(pluginType),
          dawName: pluginName(pluginType, currentDaw),
        }))
      );
  }, [currentDaw]);

  const normalize = (value: string) => value.toLowerCase().replace(/[_-]/g, " ");
  const query = normalize(search.trim());
  const searchResults = useMemo(() => {
    if (!query) return entries;

    const ordered: typeof entries = [];
    const seen = new Set<PalettePlugin>();
    const addMatches = (
      matches: Array<(entry: (typeof entries)[number]) => boolean>
    ) => {
      entries.forEach((entry) => {
        if (seen.has(entry.pluginType)) return;
        if (!matches.some((matcher) => matcher(entry))) return;
        seen.add(entry.pluginType);
        ordered.push(entry);
      });
    };

    addMatches([
      (entry) =>
        [entry.pluginType, entry.label, entry.dawName].some((value) =>
          normalize(value).startsWith(query)
        ),
    ]);
    addMatches([
      (entry) => normalize(entry.category).startsWith(query),
      (entry) => normalize(entry.category).includes(query),
    ]);
    addMatches([
      (entry) =>
        [entry.pluginType, entry.label, entry.dawName].some((value) =>
          normalize(value).includes(query)
        ),
    ]);

    return ordered;
  }, [entries, query]);

  return (
    <motion.div
      className={styles.pluginPalette}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.18 }}
    >
      <button type="button" className={styles.paletteClose} onClick={onClose}>
        x
      </button>
      <label className={styles.paletteSearch}>
        <span>Search plugins</span>
        <input
          ref={inputRef}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
          placeholder="compressor, dynamics, reverb..."
        />
      </label>
      {query ? (
        <div className={styles.paletteResults}>
          {searchResults.length > 0 ? (
            searchResults.map((entry) => (
              <button
                key={entry.pluginType}
                type="button"
                onClick={() => onSelect(entry.pluginType)}
              >
                <span>{entry.dawName}</span>
                <em>{entry.label} / {entry.category}</em>
              </button>
            ))
          ) : (
            <span className={styles.paletteEmpty}>No matching plugin.</span>
          )}
        </div>
      ) : (
        (Object.entries(PLUGIN_PALETTE) as Array<[PaletteCategory, readonly PalettePlugin[]]>)
          .map(([category, plugins]) => (
            <div className={styles.paletteCategory} key={category}>
              <span>{category}</span>
              <div className={styles.paletteGrid}>
                {plugins.map((pluginType) => (
                  <button
                    key={pluginType}
                    type="button"
                    onClick={() => onSelect(pluginType)}
                  >
                    <span>{pluginName(pluginType, currentDaw)}</span>
                    <em>{humanize(pluginType)}</em>
                  </button>
                ))}
              </div>
            </div>
          ))
      )}
    </motion.div>
  );
}

function BusPills({
  buses,
  branchGroups,
  expandedBus,
  onExpand,
}: {
  buses: BusKind[];
  branchGroups: Record<BusKind, VisualNode[]>;
  expandedBus: BusKind | null;
  onExpand: (bus: BusKind) => void;
}) {
  return (
    <motion.div
      className={styles.busPills}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {buses.map((bus) => {
        const group = branchGroups[bus];
        const active = group.length === 0 || group.some((node) => node.step.enabled !== false);

        return (
          <button
            type="button"
            key={bus}
            className={`${styles.busPill} ${active ? styles.busPillActive : ""} ${
              expandedBus === bus ? styles.busPillExpanded : ""
            }`}
            onClick={() => onExpand(bus)}
          >
            {BUS_ABBREVIATIONS[bus]}
          </button>
        );
      })}
    </motion.div>
  );
}
