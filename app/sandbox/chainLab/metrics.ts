import type {
  AnalysisResponse,
  AudioMetrics,
  ChainStep,
  EvaluationResult,
  GeneratedChain,
} from "@/lib/types";
import { getGenreProfile } from "@/lib/chainKnowledge";

export type AnalysisProvenance = Pick<
  AnalysisResponse,
  "analysis_version" | "fallback_used" | "audio_service_status"
>;

export interface AudioInsights {
  loudness: string;
  dynamicRange: string;
  brightness: string;
}

export interface MetricReadout {
  label: string;
  value: string;
  source: "measured" | "estimated" | "fallback" | "chain" | "unknown";
  statusLabel?: string;
  statusColor?: "red" | "yellow" | "green";
}

export const SAFE_ANALYSIS_PROVENANCE: AnalysisProvenance = {
  analysis_version: "1.0",
  fallback_used: true,
  audio_service_status: "unknown",
};

export function toKhz(hz: number) {
  return hz > 100 ? hz / 1000 : hz;
}

export function formatMetricDb(value: number) {
  return `${value > 0 ? "+" : ""}${Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)} dB`;
}

export function formatInsights(m: AudioMetrics): AudioInsights {
  const centroidKhz = toKhz(m.spectralCentroid);

  return {
    loudness: `${m.lufs.toFixed(1)} LUFS`,
    dynamicRange: `${m.dynamicRange.toFixed(1)} dB`,
    brightness: `${centroidKhz.toFixed(1)} kHz`,
  };
}

export function formatPresenceBand(metrics: AudioMetrics | null) {
  if (metrics && typeof metrics.harshness === "number" && Number.isFinite(metrics.harshness)) {
    const presenceDb = 10 * Math.log10(Math.max(metrics.harshness, 1e-12));
    return `${presenceDb.toFixed(1)} dB`;
  }

  return "--";
}

export function buildMetricReadouts(
  insights: AudioInsights | null,
  metrics: AudioMetrics | null,
  chain: ChainStep[],
  eraId: string,
  provenance: AnalysisProvenance | null
): MetricReadout[] {
  const profile = getGenreProfile(eraId);
  const metricSource: MetricReadout["source"] = metrics
    ? provenance?.fallback_used
      ? "estimated"
      : provenance?.audio_service_status === "ok"
        ? "measured"
        : "fallback"
    : "unknown";
  let lufsStatusLabel: string | undefined;
  let lufsStatusColor: MetricReadout["statusColor"];
  if (metrics) {
    const diff = metrics.lufs - profile.lufs_target;
    if (diff < -3) { lufsStatusLabel = "Too Quiet"; lufsStatusColor = "red"; }
    else if (diff > 2) { lufsStatusLabel = "Too Loud"; lufsStatusColor = "red"; }
    else if (diff < -1) { lufsStatusLabel = "Quiet"; lufsStatusColor = "yellow"; }
    else if (diff > 1) { lufsStatusLabel = "Loud"; lufsStatusColor = "yellow"; }
    else { lufsStatusLabel = "Good"; lufsStatusColor = "green"; }
  }

  let drStatusLabel: string | undefined;
  let drStatusColor: MetricReadout["statusColor"];
  if (metrics) {
    const diff = metrics.dynamicRange - profile.dynamic_range_target;
    if (diff > 6) { drStatusLabel = "Too Dynamic"; drStatusColor = "red"; }
    else if (diff < -2) { drStatusLabel = "Overcompressed"; drStatusColor = "red"; }
    else if (diff > 3) { drStatusLabel = "Dynamic"; drStatusColor = "yellow"; }
    else if (diff < -1) { drStatusLabel = "Compressed"; drStatusColor = "yellow"; }
    else { drStatusLabel = "Good"; drStatusColor = "green"; }
  }

  let brightStatusLabel: string | undefined;
  let brightStatusColor: MetricReadout["statusColor"];
  if (metrics) {
    const khz = toKhz(metrics.spectralCentroid);
    if (khz > 6) { brightStatusLabel = "Too Bright"; brightStatusColor = "red"; }
    else if (khz < 1.5) { brightStatusLabel = "Too Dark"; brightStatusColor = "red"; }
    else if (khz > 4) { brightStatusLabel = "Bright"; brightStatusColor = "yellow"; }
    else if (khz < 2) { brightStatusLabel = "Dark"; brightStatusColor = "yellow"; }
    else { brightStatusLabel = "Good"; brightStatusColor = "green"; }
  }

  let presStatusLabel: string | undefined;
  let presStatusColor: MetricReadout["statusColor"];
  if (metrics && typeof metrics.harshness === "number" && Number.isFinite(metrics.harshness)) {
    const pres = 10 * Math.log10(Math.max(metrics.harshness, 1e-12));
    if (pres > -40) { presStatusLabel = "Harsh"; presStatusColor = "red"; }
    else if (pres < -80) { presStatusLabel = "Dull"; presStatusColor = "red"; }
    else if (pres > -50) { presStatusLabel = "Present"; presStatusColor = "yellow"; }
    else if (pres < -70) { presStatusLabel = "Recessed"; presStatusColor = "yellow"; }
    else { presStatusLabel = "Good"; presStatusColor = "green"; }
  }

  return [
    {
      label: "Loudness",
      value: insights?.loudness ?? (metrics ? `${metrics.lufs.toFixed(1)} LUFS` : "--"),
      source: metricSource,
      statusLabel: lufsStatusLabel,
      statusColor: lufsStatusColor,
    },
    {
      label: "Dynamic Range",
      value:
        insights?.dynamicRange ??
        (metrics ? `${metrics.dynamicRange.toFixed(1)} dB` : "--"),
      source: metricSource,
      statusLabel: drStatusLabel,
      statusColor: drStatusColor,
    },
    {
      label: "Brightness",
      value:
        insights?.brightness ??
        (metrics ? `${toKhz(metrics.spectralCentroid).toFixed(1)} kHz` : "--"),
      source: metricSource,
      statusLabel: brightStatusLabel,
      statusColor: brightStatusColor,
    },
    {
      label: "Presence",
      value: formatPresenceBand(metrics),
      source:
        metrics && typeof metrics.harshness === "number" && Number.isFinite(metrics.harshness)
          ? metricSource
          : chain.length > 0
            ? "chain"
            : "unknown",
      statusLabel: presStatusLabel,
      statusColor: presStatusColor,
    },
  ];
}

export function provenanceFromResult(result: AnalysisResponse): AnalysisProvenance {
  return {
    analysis_version: result.analysis_version,
    fallback_used: result.fallback_used,
    audio_service_status: result.audio_service_status,
  };
}

export function provenanceFromChainData(
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

export function hasMeasuredProvenance(provenance: AnalysisProvenance | null) {
  return Boolean(provenance && !provenance.fallback_used && provenance.audio_service_status === "ok");
}

export function measuredFitForProvenance(
  measuredFit: EvaluationResult["measured_fit"] | undefined,
  provenance: AnalysisProvenance | null
): EvaluationResult["measured_fit"] {
  return measuredFit === "good" && !hasMeasuredProvenance(provenance)
    ? "unknown"
    : measuredFit ?? "unknown";
}
