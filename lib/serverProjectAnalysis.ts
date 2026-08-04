import {
  assertProjectAssetOwnership,
  resolveProjectAssetFile,
} from "@/lib/serverProjectAudio";
import {
  issueStemJobToken,
  verifyStemJobToken,
} from "@/lib/serverStemJob";
import type {
  DiagnosisFinding,
  ProjectAnalysisErrorCode,
  ProjectAnalysisFlowResponse,
  ProjectAnalysisInputMode,
  ProjectAnalysisResponse,
  RecordingEvidence,
  RecordingEvidenceKind,
  StemSplitJobResponse,
  VocalCheckMeasurements,
} from "@/lib/types";

type RawMetricSet = Record<string, unknown>;

interface RawCollision {
  start_seconds?: unknown;
  end_seconds?: unknown;
  frequency_low_hz?: unknown;
  frequency_high_hz?: unknown;
  vocal_energy_db?: unknown;
  beat_energy_db?: unknown;
  masking_delta_db?: unknown;
  analysis_version?: unknown;
}

interface RawRecordingEvidence {
  kind?: unknown;
  start_seconds?: unknown;
  end_seconds?: unknown;
  delta_db?: unknown;
  baseline_db?: unknown;
  measured_db?: unknown;
  frequency_low_hz?: unknown;
  frequency_high_hz?: unknown;
  analysis_version?: unknown;
}

interface RawAnalysis {
  vocal?: RawMetricSet;
  beat?: RawMetricSet | null;
  frequency_collisions?: RawCollision[];
  recording_events?: RawRecordingEvidence[];
}

const ANALYSIS_VERSION = "mimiq-diagnosis-v2";
const DEFAULT_COLLISION_VERSION = "temporal_masking_v2";
const DEFAULT_RECORDING_VERSION = "recording_events_v2";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function severityForDelta(deltaDb: number, duration: number) {
  const magnitude = Math.abs(deltaDb);
  if (magnitude >= 9 || (magnitude >= 6 && duration >= 0.75)) return "high" as const;
  if (magnitude >= 5 || duration >= 1.5) return "medium" as const;
  return "low" as const;
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function recordingKind(value: unknown): value is RecordingEvidenceKind {
  return (
    value === "presence_spike" ||
    value === "low_mid_buildup" ||
    value === "sibilance_spike" ||
    value === "level_inconsistency"
  );
}

function shapeRecordingEvidence(
  raw: RawRecordingEvidence[],
  inputAssetIds: string[]
) {
  return raw.flatMap((event): Array<{
    evidence: RecordingEvidence;
    finding: DiagnosisFinding;
  }> => {
    if (
      !recordingKind(event.kind) ||
      !finite(event.start_seconds) ||
      !finite(event.end_seconds) ||
      !finite(event.delta_db) ||
      !finite(event.baseline_db) ||
      !finite(event.measured_db)
    ) {
      return [];
    }

    const kind = event.kind;
    const start = event.start_seconds;
    const end = event.end_seconds;
    const delta = event.delta_db;
    const low = finite(event.frequency_low_hz) ? event.frequency_low_hz : null;
    const high = finite(event.frequency_high_hz) ? event.frequency_high_hz : null;
    const version =
      typeof event.analysis_version === "string"
        ? event.analysis_version
        : DEFAULT_RECORDING_VERSION;
    const evidence: RecordingEvidence = {
      kind,
      startSeconds: start,
      endSeconds: end,
      deltaDb: delta,
      baselineDb: event.baseline_db,
      measuredDb: event.measured_db,
      frequencyLowHz: low,
      frequencyHighHz: high,
      analysisVersion: version,
    };
    const copy = {
      presence_spike: {
        title: "Presence spike relative to this take",
        findingKind: "presence" as const,
        capability: "equalizer" as const,
        why: "The measured 2–5 kHz energy rises above this take’s own active-vocal baseline in this range.",
      },
      low_mid_buildup: {
        title: "Low-mid buildup relative to this take",
        findingKind: "low_mid" as const,
        capability: "equalizer" as const,
        why: "The measured 180–500 Hz energy rises above this take’s own active-vocal baseline in this range.",
      },
      sibilance_spike: {
        title: "Sibilance spike relative to this take",
        findingKind: "sibilance" as const,
        capability: "de_esser" as const,
        why: "The measured 5–10 kHz energy rises above this take’s own active-vocal baseline in this range.",
      },
      level_inconsistency: {
        title: delta >= 0 ? "Level jump relative to this take" : "Level drop relative to this take",
        findingKind: "level_inconsistency" as const,
        capability: "compressor" as const,
        why: "The measured frame level differs from this take’s active-vocal median in this exact range.",
      },
    }[kind];

    return [{
      evidence,
      finding: {
        id: `recording-${kind}-${start.toFixed(3)}`,
        kind: copy.findingKind,
        title: copy.title,
        severity: severityForDelta(delta, end - start),
        impactRank: 0,
        evidence: {
          measurementKey: `recording_events.${kind}`,
          source: "measured",
          analysisVersion: version,
          inputAssetIds: inputAssetIds.slice(0, 1),
          startSeconds: start,
          endSeconds: end,
          frequencyLowHz: low,
          frequencyHighHz: high,
        },
        value: delta,
        unit: "dB relative to take baseline",
        whyItMatters: copy.why,
        suggestedCapability: copy.capability,
        limitations: [
          "This is a within-take delta, not a genre target or a claim that processing is always required.",
        ],
      },
    }];
  });
}

export function shapeProjectAnalysis(params: {
  analysis: RawAnalysis | null;
  vocalCheck: VocalCheckMeasurements | null;
  inputAssetIds: string[];
  contextFingerprint: string;
  inputMode?: ProjectAnalysisInputMode;
  analysisError?: string | null;
  vocalCheckError?: string | null;
}): ProjectAnalysisResponse {
  const inputMode = params.inputMode ?? "separate";
  const collisions = Array.isArray(params.analysis?.frequency_collisions)
    ? params.analysis.frequency_collisions
    : [];
  const collisionFindings: DiagnosisFinding[] = collisions
    .filter(
      (collision) =>
        finite(collision.start_seconds) &&
        finite(collision.end_seconds) &&
        finite(collision.frequency_low_hz) &&
        finite(collision.frequency_high_hz) &&
        finite(collision.vocal_energy_db) &&
        finite(collision.beat_energy_db) &&
        finite(collision.masking_delta_db)
    )
    .map((collision, index) => {
      const start = collision.start_seconds as number;
      const end = collision.end_seconds as number;
      const low = collision.frequency_low_hz as number;
      const high = collision.frequency_high_hz as number;
      const masking = collision.masking_delta_db as number;
      const version =
        typeof collision.analysis_version === "string"
          ? collision.analysis_version
          : DEFAULT_COLLISION_VERSION;
      return {
        id: `collision-${index + 1}`,
        kind: "collision" as const,
        title: `Vocal and beat overlap from ${(low / 1000).toFixed(1)}–${(high / 1000).toFixed(1)} kHz`,
        severity: severityForDelta(masking, end - start),
        impactRank: 0,
        evidence: {
          measurementKey: `frequency_collisions.${index}`,
          source: "measured" as const,
          analysisVersion: version,
          inputAssetIds: params.inputAssetIds,
          startSeconds: start,
          endSeconds: end,
          frequencyLowHz: low,
          frequencyHighHz: high,
        },
        vocalEnergyDb: collision.vocal_energy_db as number,
        beatEnergyDb: collision.beat_energy_db as number,
        maskingDeltaDb: masking,
        whyItMatters:
          "The beat has similar or higher measured energy in a vocal band during this exact range, which can reduce vocal clarity.",
        suggestedCapability: "equalizer" as const,
        limitations: [
          "Masking is measured from signal energy; arrangement intent and lyric importance are not inferred.",
        ],
      };
    });

  const shapedRecording = shapeRecordingEvidence(
    Array.isArray(params.analysis?.recording_events)
      ? params.analysis.recording_events
      : [],
    params.inputAssetIds
  );
  const findings = [
    ...collisionFindings,
    ...shapedRecording.map((item) => item.finding),
  ];

  if (params.vocalCheck?.inKeyVoicedFrameRatio != null) {
    findings.push({
      id: "pitch-alignment",
      kind: "pitch",
      title: "Pitch alignment",
      severity:
        params.vocalCheck.inKeyVoicedFrameRatio < 0.6 ? "medium" : "info",
      impactRank: 0,
      evidence: {
        measurementKey: "vocal_check.in_key_voiced_frame_ratio",
        source: "measured",
        analysisVersion: params.vocalCheck.analysisVersion,
        inputAssetIds: params.inputAssetIds.slice(0, 1),
      },
      value: params.vocalCheck.inKeyVoicedFrameRatio,
      unit: "ratio",
      whyItMatters:
        "This is the share of reliably voiced frames nearest to notes in the detected scale; it is not a performance quality score.",
      suggestedCapability:
        params.vocalCheck.inKeyVoicedFrameRatio < 0.75 ? "pitch" : null,
      limitations: [
        "Key detection can be ambiguous when the vocal is unaccompanied or highly expressive.",
      ],
    });
  }

  const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((left, right) => {
    const severity = severityOrder[left.severity] - severityOrder[right.severity];
    if (severity !== 0) return severity;
    return Math.abs(right.maskingDeltaDb ?? right.value ?? 0) - Math.abs(left.maskingDeltaDb ?? left.value ?? 0);
  });
  findings.forEach((finding, index) => {
    finding.impactRank = index + 1;
  });

  const limitations = [
    ...(inputMode === "stem_split"
      ? ["Stem-split input can contain separation artifacts, so vocal/beat evidence is lower precision than separate uploads."]
      : []),
    ...(params.analysisError ? [`Audio measurements skipped: ${params.analysisError}`] : []),
    ...(params.vocalCheckError ? [`Pitch measurements skipped: ${params.vocalCheckError}`] : []),
  ];
  const skippedMeasurements = [
    ...(params.analysisError
      ? ["loudness", "true_peak", "dynamics", "recording_events", "collisions"]
      : []),
    ...(params.vocalCheckError ? ["key", "bpm", "pitch_alignment"] : []),
  ];
  const hasMeasuredData = Boolean(params.analysis || params.vocalCheck);
  const isPartial = hasMeasuredData && skippedMeasurements.length > 0;

  return {
    measurements: {
      vocal: params.analysis?.vocal ?? null,
      beat: params.analysis?.beat ?? null,
      vocalCheck: params.vocalCheck,
      recordingEvidence: shapedRecording.map((item) => item.evidence),
    },
    findings,
    recordingEvidence: shapedRecording.map((item) => item.evidence),
    vocalCheck: params.vocalCheck,
    inputMode,
    provenance: {
      source: hasMeasuredData ? "fastapi" : "unknown",
      status: hasMeasuredData ? (isPartial ? "fallback" : "ok") : "error",
      algorithmVersion: ANALYSIS_VERSION,
      createdAt: new Date().toISOString(),
      skippedMeasurements,
      contextFingerprint: params.contextFingerprint,
    },
    limitations,
    fallback_used: inputMode === "stem_split" || isPartial,
    fallback_reason: limitations.length > 0 ? limitations.join(" ") : null,
  };
}

async function readUpstreamError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { detail?: string; message?: string };
    return body.message ?? body.detail ?? `Audio service returned ${response.status}.`;
  } catch {
    return text || `Audio service returned ${response.status}.`;
  }
}

async function ensureAudioService(serviceUrl: string) {
  try {
    const response = await fetch(`${serviceUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function postAudio(serviceUrl: string, path: string, form: FormData) {
  const response = await fetch(`${serviceUrl}${path}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(await readUpstreamError(response));
  return response.json();
}

function analysisError(params: {
  inputMode: ProjectAnalysisInputMode | null;
  code: ProjectAnalysisErrorCode;
  stage: "preparing" | "separating" | "analyzing" | "saving" | "failed";
  message: string;
  retryable: boolean;
  skippedMeasurements: string[];
}): ProjectAnalysisFlowResponse {
  return {
    status: "error",
    inputMode: params.inputMode,
    code: params.code,
    stage: params.stage,
    message: params.message,
    retryable: params.retryable,
    limitations: [params.message, "No unmeasured result was substituted."],
    skippedMeasurements: params.skippedMeasurements,
  };
}

async function startMixedSongSplit(params: {
  serviceUrl: string;
  file: File;
  projectId: string;
  sourceAssetId: string;
}): Promise<ProjectAnalysisFlowResponse> {
  const splitForm = new FormData();
  splitForm.append("audio", params.file);
  splitForm.append("mode", "2");
  splitForm.append("model", "htdemucs");
  try {
    const created = await postAudio(
      params.serviceUrl,
      "/api/split-stems",
      splitForm
    ) as StemSplitJobResponse;
    if (!created.job_id) throw new Error("Stem Rip did not return a job ID.");
    return {
      status: "processing",
      inputMode: "stem_split",
      jobId: created.job_id,
      jobToken: issueStemJobToken({
        jobId: created.job_id,
        projectId: params.projectId,
        sourceAssetId: params.sourceAssetId,
      }),
      progress: created.progress ?? 0,
      stage: created.stage ?? "queued",
      message: created.message ?? "Stem split queued.",
      estimatedRemainingSeconds: created.estimated_remaining_seconds ?? null,
    };
  } catch (error) {
    return analysisError({
      inputMode: "stem_split",
      code: "stem_split_failed",
      stage: "separating",
      message: errorMessage(error),
      retryable: true,
      skippedMeasurements: ["stems", "loudness", "pitch", "collisions"],
    });
  }
}

async function loadCompletedSplit(params: {
  serviceUrl: string;
  jobId: string;
  jobToken: string;
  projectId: string;
  sourceAssetId: string;
}): Promise<
  | ProjectAnalysisFlowResponse
  | { vocal: File; beat: File }
> {
  if (!verifyStemJobToken(params.jobToken, {
    jobId: params.jobId,
    projectId: params.projectId,
    sourceAssetId: params.sourceAssetId,
  })) {
    return analysisError({
      inputMode: "stem_split",
      code: "invalid_request",
      stage: "separating",
      message: "This Stem Rip job does not belong to the selected project audio.",
      retryable: false,
      skippedMeasurements: ["stems", "loudness", "pitch", "collisions"],
    });
  }

  try {
    const statusResponse = await fetch(
      `${params.serviceUrl}/api/split-stems/${params.jobId}`,
      { cache: "no-store", signal: AbortSignal.timeout(10000) }
    );
    if (!statusResponse.ok) throw new Error(await readUpstreamError(statusResponse));
    const job = await statusResponse.json() as StemSplitJobResponse;
    if (job.status === "failed") {
      throw new Error(job.error ?? "Stem separation failed.");
    }
    if (job.status !== "complete") {
      return {
        status: "processing",
        inputMode: "stem_split",
        jobId: params.jobId,
        jobToken: params.jobToken,
        progress: job.progress ?? 0,
        stage: job.stage ?? "processing",
        message: job.message ?? "Separating vocal and instrumental.",
        estimatedRemainingSeconds: job.estimated_remaining_seconds ?? null,
      };
    }

    const [vocalResponse, beatResponse] = await Promise.all([
      fetch(`${params.serviceUrl}/api/split-stems/${params.jobId}/files/vocals`),
      fetch(`${params.serviceUrl}/api/split-stems/${params.jobId}/files/instrumental`),
    ]);
    if (!vocalResponse.ok || !beatResponse.ok) {
      throw new Error("Stem Rip completed but the vocal or full instrumental was unavailable.");
    }
    const [vocalBlob, beatBlob] = await Promise.all([
      vocalResponse.blob(),
      beatResponse.blob(),
    ]);
    return {
      vocal: new File([vocalBlob], "stem-rip-vocal.wav", { type: "audio/wav" }),
      beat: new File([beatBlob], "stem-rip-instrumental.wav", { type: "audio/wav" }),
    };
  } catch (error) {
    return analysisError({
      inputMode: "stem_split",
      code: "stem_split_failed",
      stage: "separating",
      message: errorMessage(error),
      retryable: true,
      skippedMeasurements: ["stems", "loudness", "pitch", "collisions"],
    });
  }
}

export async function runProjectAnalysis(
  req: Request,
  formData: FormData
): Promise<ProjectAnalysisFlowResponse> {
  const projectId = String(formData.get("projectId") ?? "");
  const vocalAssetId = String(formData.get("vocalAssetId") ?? "");
  const beatAssetId = String(formData.get("beatAssetId") ?? "");
  const fullSongAssetId = String(formData.get("fullSongAssetId") ?? "");
  const processedAssetId = String(formData.get("processedAssetId") ?? "");
  const contextFingerprint = String(formData.get("contextFingerprint") ?? "");
  const stemJobId = String(formData.get("stemJobId") ?? "");
  const stemJobToken = String(formData.get("stemJobToken") ?? "");
  const inputMode: ProjectAnalysisInputMode = fullSongAssetId
    ? "stem_split"
    : "separate";
  const serviceUrl = process.env.AUDIO_SERVICE_URL;
  if (!serviceUrl || !(await ensureAudioService(serviceUrl))) {
    return analysisError({
      inputMode,
      code: "audio_service_unavailable",
      stage: "preparing",
      message: "The audio measurement service is offline. Start it and retry diagnosis.",
      retryable: true,
      skippedMeasurements: ["loudness", "true_peak", "dynamics", "pitch", "collisions"],
    });
  }

  const sourceParams = {
    req,
    projectId,
    assetId: processedAssetId || vocalAssetId || fullSongAssetId,
    allowedKinds: processedAssetId
      ? ["processed" as const]
      : fullSongAssetId
        ? ["full_song" as const]
        : ["vocal" as const],
    label: processedAssetId
      ? "Processed vocal"
      : fullSongAssetId
        ? "Mixed song"
        : "Dry vocal",
  };
  const ownedSource = fullSongAssetId && stemJobId
    ? await assertProjectAssetOwnership(sourceParams)
    : await resolveProjectAssetFile(sourceParams);
  if (!ownedSource) {
    return analysisError({
      inputMode,
      code: "invalid_request",
      stage: "preparing",
      message: "A vocal or mixed-song asset is required.",
      retryable: false,
      skippedMeasurements: ["loudness", "true_peak", "dynamics", "pitch", "collisions"],
    });
  }
  const beat = beatAssetId
    ? await resolveProjectAssetFile({
        req,
        projectId,
        assetId: beatAssetId,
        allowedKinds: ["beat"],
        label: "Beat",
      })
    : null;

  if (fullSongAssetId && !stemJobId) {
    if (!("file" in ownedSource)) {
      return analysisError({
        inputMode,
        code: "stem_split_failed",
        stage: "preparing",
        message: "The mixed-song source could not be loaded for Stem Rip.",
        retryable: true,
        skippedMeasurements: ["stems", "loudness", "pitch", "collisions"],
      });
    }
    return startMixedSongSplit({
      serviceUrl,
      file: ownedSource.file,
      projectId,
      sourceAssetId: fullSongAssetId,
    });
  }

  let analysisVocal = "file" in ownedSource ? ownedSource.file : null;
  let analysisBeat = beat?.file ?? null;
  if (fullSongAssetId) {
    const split = await loadCompletedSplit({
      serviceUrl,
      jobId: stemJobId,
      jobToken: stemJobToken,
      projectId,
      sourceAssetId: fullSongAssetId,
    });
    if ("status" in split) return split;
    analysisVocal = split.vocal;
    analysisBeat = split.beat;
  }

  if (!analysisVocal) {
    return analysisError({
      inputMode,
      code: "measurement_failed",
      stage: "analyzing",
      message: "The analysis vocal was unavailable after preparation.",
      retryable: true,
      skippedMeasurements: ["loudness", "true_peak", "dynamics", "pitch", "collisions"],
    });
  }

  const analysisForm = new FormData();
  analysisForm.append("vocal", analysisVocal);
  if (analysisBeat) analysisForm.append("beat", analysisBeat);
  const vocalCheckForm = new FormData();
  vocalCheckForm.append("vocal", analysisVocal);

  const [analysisResult, vocalCheckResult] = await Promise.allSettled([
    postAudio(serviceUrl, "/analyze", analysisForm),
    postAudio(serviceUrl, "/api/diagnose-vocal", vocalCheckForm),
  ]);
  const analysis = analysisResult.status === "fulfilled"
    ? analysisResult.value as RawAnalysis
    : null;
  const vocalCheck = vocalCheckResult.status === "fulfilled"
    ? vocalCheckResult.value as VocalCheckMeasurements
    : null;

  if (!analysis && !vocalCheck) {
    return analysisError({
      inputMode,
      code: "measurement_failed",
      stage: "analyzing",
      message: [analysisResult, vocalCheckResult]
        .filter((result) => result.status === "rejected")
        .map((result) => errorMessage((result as PromiseRejectedResult).reason))
        .join(" ") || "The audio service returned no measured sections.",
      retryable: true,
      skippedMeasurements: ["loudness", "true_peak", "dynamics", "pitch", "collisions"],
    });
  }

  return {
    status: "complete",
    inputMode,
    result: shapeProjectAnalysis({
      analysis,
      vocalCheck,
      inputAssetIds: [ownedSource.asset.id, beat?.asset.id].filter(Boolean) as string[],
      contextFingerprint,
      inputMode,
      analysisError:
        analysisResult.status === "rejected"
          ? errorMessage(analysisResult.reason)
          : null,
      vocalCheckError:
        vocalCheckResult.status === "rejected"
          ? errorMessage(vocalCheckResult.reason)
          : null,
    }),
  };
}
