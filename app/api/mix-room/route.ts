import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AudioServiceStatus,
  CollisionZone,
  MixRoomReport,
  PocketZone,
  SpectralData,
} from "@/lib/types";
import {
  assetResolutionResponse,
  resolveProjectAssetFile,
} from "@/lib/serverProjectAudio";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_DB = -80;
const MAX_DB = 0;
const COLLISION_THRESHOLD_DB = -42;
const COLLISION_GAP_DB = 7;
const POCKET_BEAT_THRESHOLD_DB = -52;
const POCKET_VOCAL_THRESHOLD_DB = -56;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy",
});

interface MixRoomRequest {
  collisions?: CollisionZone[];
  daw?: string;
  genre?: string;
}

interface MixRoomFormResponse {
  report: MixRoomReport;
  spectrum: {
    vocal: SpectralData;
    beat: SpectralData;
  };
  audio_service_status: AudioServiceStatus;
  fallback_used: boolean;
  fallback_reason: string | null;
}

interface FastAPIMixRoomResponse {
  vocal_spectrum?: unknown;
  beat_spectrum?: unknown;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function cleanSpectrum(value: unknown): SpectralData | null {
  const data = value as Partial<SpectralData> | null;
  if (!data || !Array.isArray(data.frequencies) || !Array.isArray(data.magnitudes)) {
    return null;
  }

  const points = data.frequencies
    .map((freq, index) => ({
      freq: numberFrom(freq),
      db: numberFrom(data.magnitudes?.[index]),
    }))
    .filter(
      (point): point is { freq: number; db: number } =>
        point.freq !== null &&
        point.db !== null &&
        point.freq >= MIN_FREQ &&
        point.freq <= MAX_FREQ
    )
    .sort((a, b) => a.freq - b.freq);

  if (points.length < 8) return null;

  return {
    frequencies: points.map((point) => point.freq),
    magnitudes: points.map((point) => clamp(point.db, -120, MAX_DB)),
  };
}

function parseSpectrum(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") return null;

  try {
    return cleanSpectrum(JSON.parse(raw));
  } catch {
    return null;
  }
}

function interpolateSpectrum(data: SpectralData, frequency: number) {
  if (data.frequencies.length < 2) return MIN_DB;

  for (let i = 1; i < data.frequencies.length; i++) {
    const prevFreq = data.frequencies[i - 1];
    const nextFreq = data.frequencies[i];
    if (prevFreq == null || nextFreq == null) continue;
    if (frequency <= nextFreq) {
      const prevDb = data.magnitudes[i - 1] ?? MIN_DB;
      const nextDb = data.magnitudes[i] ?? MIN_DB;
      const ratio = clamp((frequency - prevFreq) / Math.max(1, nextFreq - prevFreq), 0, 1);
      return prevDb * (1 - ratio) + nextDb * ratio;
    }
  }

  return data.magnitudes[data.magnitudes.length - 1] ?? MIN_DB;
}

function findCollisions(vocal: SpectralData, beat: SpectralData): CollisionZone[] {
  const zones: CollisionZone[] = [];

  for (let i = 0; i < vocal.frequencies.length; i++) {
    const freq = vocal.frequencies[i];
    if (freq == null || freq < MIN_FREQ || freq > MAX_FREQ) continue;

    const vocalDb = vocal.magnitudes[i] ?? MIN_DB;
    const beatDb = interpolateSpectrum(beat, freq);
    const overlap = Math.min(vocalDb, beatDb);
    const maskingGap = Math.abs(vocalDb - beatDb);

    if (overlap > COLLISION_THRESHOLD_DB && maskingGap <= COLLISION_GAP_DB) {
      const severity =
        Math.max(0, overlap - COLLISION_THRESHOLD_DB) * 1.8 +
        Math.max(0, COLLISION_GAP_DB - maskingGap) * 2.2;
      const previous = zones[zones.length - 1];

      if (previous && freq - previous.endFreq < 70) {
        previous.endFreq = freq;
        previous.peakVocalDb = Math.max(previous.peakVocalDb, vocalDb);
        previous.peakBeatDb = Math.max(previous.peakBeatDb, beatDb);

        if (severity > previous.severity) {
          previous.severity = severity;
          previous.centerFreq = freq;
        }
      } else {
        zones.push({
          startFreq: freq,
          endFreq: freq,
          centerFreq: freq,
          severity,
          peakVocalDb: vocalDb,
          peakBeatDb: beatDb,
        });
      }
    }
  }

  return zones
    .filter((zone) => zone.endFreq - zone.startFreq > 25)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 12);
}

function findPockets(vocal: SpectralData, beat: SpectralData): PocketZone[] {
  const zones: PocketZone[] = [];

  for (let i = 0; i < vocal.frequencies.length; i++) {
    const freq = vocal.frequencies[i];
    if (freq == null || freq < MIN_FREQ || freq > MAX_FREQ) continue;

    const vocalDb = vocal.magnitudes[i] ?? MIN_DB;
    const beatDb = interpolateSpectrum(beat, freq);

    if (beatDb < POCKET_BEAT_THRESHOLD_DB && vocalDb > POCKET_VOCAL_THRESHOLD_DB) {
      const strength = vocalDb - beatDb;
      const previous = zones[zones.length - 1];

      if (previous && freq - previous.endFreq < 90) {
        previous.endFreq = freq;
        if (strength > previous.strength) {
          previous.strength = strength;
          previous.centerFreq = freq;
          previous.vocalDb = vocalDb;
          previous.beatDb = beatDb;
        }
      } else {
        zones.push({
          startFreq: freq,
          endFreq: freq,
          centerFreq: freq,
          strength,
          vocalDb,
          beatDb,
        });
      }
    }
  }

  return zones
    .filter((zone) => zone.endFreq - zone.startFreq > 35)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 10);
}

function formatFreq(freq: number) {
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }

  return `${Math.round(freq)} Hz`;
}

function pluginForDaw(daw: string) {
  const lower = daw.toLowerCase();
  if (lower.includes("fl")) return "Fruity Parametric EQ 2";
  if (lower.includes("ableton")) return "EQ Eight";
  if (lower.includes("logic")) return "Channel EQ";
  if (lower.includes("pro tools")) return "EQ III";
  if (lower.includes("studio one")) return "Pro EQ";
  return "your stock EQ";
}

function makeSummary(collisions: CollisionZone[], pockets: PocketZone[]) {
  if (collisions.length > 0) {
    const first = collisions[0];
    return `${collisions.length} fight ${collisions.length === 1 ? "spot" : "spots"} found. The loudest one is around ${formatFreq(first.centerFreq)}.`;
  }

  if (pockets.length > 0) {
    return `The vocal has room right now. The cleanest opening is around ${formatFreq(pockets[0].centerFreq)}.`;
  }

  return "The vocal and beat are not fighting in a major spot right now.";
}

function makeMatchScore(collisions: CollisionZone[], pockets: PocketZone[]) {
  const collisionPressure = collisions
    .slice(0, 4)
    .reduce((sum, zone) => sum + zone.severity, 0);
  const pocketLift = Math.min(
    16,
    pockets.slice(0, 3).reduce((sum, zone) => sum + zone.strength, 0) / 8
  );

  return Math.round(clamp(92 - collisionPressure * 0.95 + pocketLift, 0, 100));
}

function plainExplanation(collisions: CollisionZone[], daw: string) {
  const first = collisions[0];
  if (!first) {
    return "Your vocal has enough room against this beat. Leave the vocal EQ alone for now and only make small changes if words start getting hidden.";
  }

  const second = collisions[1];
  const plugin = pluginForDaw(daw);
  const firstMove = `Your vocal and beat are fighting around ${formatFreq(first.centerFreq)}. Open ${plugin} on the vocal channel and make a small cut there so the beat has room and the words stay clear.`;

  if (!second) return firstMove;

  return `${firstMove} If it still feels crowded, make a lighter cut around ${formatFreq(second.centerFreq)} too.`;
}

function fallbackExplanation(collisions: CollisionZone[], daw: string) {
  return plainExplanation(collisions, daw);
}

async function callAudioService(vocalFile: File, beatFile: File) {
  const serviceUrl = process.env.AUDIO_SERVICE_URL;
  if (!serviceUrl) {
    return {
      raw: null,
      status: "fallback" as AudioServiceStatus,
      reason: "AUDIO_SERVICE_URL is not configured.",
    };
  }

  const form = new FormData();
  form.append("vocal", vocalFile);
  form.append("beat", beatFile);

  try {
    const res = await fetch(`${serviceUrl}/analyze`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      return {
        raw: null,
        status: "fallback" as AudioServiceStatus,
        reason: `Audio service returned ${res.status}.`,
      };
    }

    return {
      raw: (await res.json()) as FastAPIMixRoomResponse,
      status: "ok" as AudioServiceStatus,
      reason: null,
    };
  } catch (error) {
    return {
      raw: null,
      status: "fallback" as AudioServiceStatus,
      reason:
        error instanceof Error
          ? error.message
          : "Audio service was unavailable.",
    };
  }
}

function fileFromForm(form: FormData, ...keys: string[]) {
  for (const key of keys) {
    const value = form.get(key);
    if (value instanceof File && value.size > 0) return value;
  }
  return null;
}

async function handleFormAnalysis(req: NextRequest) {
  const form = await req.formData();
  let vocalFile = fileFromForm(form, "vocalFile", "vocal");
  let beatFile = fileFromForm(form, "beatFile", "beat");
  const daw = (form.get("daw") as string) || "Logic Pro";
  const genre = (form.get("genre") as string) || "Rap";
  const vocalSource = (form.get("vocalSource") as string) || null;
  const beatSource = (form.get("beatSource") as string) || null;
  const vocalVersionId = (form.get("vocalVersionId") as string) || null;
  const projectId = (form.get("projectId") as string) || null;
  const vocalAssetId = (form.get("vocalAssetId") as string) || null;
  const beatAssetId = (form.get("beatAssetId") as string) || null;
  const fullSongAssetId = (form.get("fullSongAssetId") as string) || null;

  try {
    const fullSongAsset = await resolveProjectAssetFile({
      req,
      projectId,
      assetId: fullSongAssetId,
      allowedKinds: ["full_song"],
      label: "Full song",
    });
    const vocalAsset = await resolveProjectAssetFile({
      req,
      projectId,
      assetId: fullSongAssetId ? null : vocalAssetId,
      allowedKinds: ["vocal"],
      label: "Vocal",
    });
    const beatAsset = await resolveProjectAssetFile({
      req,
      projectId,
      assetId: fullSongAssetId ? null : beatAssetId,
      allowedKinds: ["beat"],
      label: "Beat",
    });

    vocalFile = fullSongAsset?.file ?? vocalAsset?.file ?? vocalFile;
    beatFile = fullSongAsset?.file ?? beatAsset?.file ?? beatFile;
  } catch (error) {
    const response = assetResolutionResponse(error);
    if (response) return response;
    throw error;
  }

  if (!vocalFile || !beatFile) {
    const missing = [
      ...(vocalFile ? [] : ["vocal"]),
      ...(beatFile ? [] : ["beat"]),
    ];
    return NextResponse.json(
      {
        error: "missing_files",
        missing,
        message:
          missing.length === 2
            ? "Upload a vocal and a beat before running Mix Room."
            : `Upload a ${missing[0]} before running Mix Room.`,
      },
      { status: 400 }
    );
  }

  if (vocalFile.size > MAX_FILE_SIZE || beatFile.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: "Mix Room supports vocal and beat files up to 50 MB each.",
      },
      { status: 413 }
    );
  }

  const service = await callAudioService(vocalFile, beatFile);
  const serviceVocalSpectrum = cleanSpectrum(service.raw?.vocal_spectrum);
  const serviceBeatSpectrum = cleanSpectrum(service.raw?.beat_spectrum);
  const clientVocalSpectrum = parseSpectrum(form.get("vocalSpectrum"));
  const clientBeatSpectrum = parseSpectrum(form.get("beatSpectrum"));
  const vocalSpectrum = serviceVocalSpectrum ?? clientVocalSpectrum;
  const beatSpectrum = serviceBeatSpectrum ?? clientBeatSpectrum;
  const usedClientSpectrum = !serviceVocalSpectrum || !serviceBeatSpectrum;

  if (!vocalSpectrum || !beatSpectrum) {
    return NextResponse.json(
      {
        error: "analysis_unavailable",
        message:
          "Mix Room could not read frequency data from both files. Try the upload again with a WAV or MP3 export.",
        audio_service_status: service.status,
        fallback_used: true,
        fallback_reason: service.reason,
      },
      { status: 422 }
    );
  }

  const collisions = findCollisions(vocalSpectrum, beatSpectrum);
  const pockets = findPockets(vocalSpectrum, beatSpectrum);
  const report: MixRoomReport = {
    version: 1,
    analysis_version: usedClientSpectrum ? "browser_fft_v1" : "mix_room_v1",
    analyzed_at: new Date().toISOString(),
    vocal_version_id: vocalVersionId,
    vocal_asset_id: vocalAssetId,
    beat_asset_id: beatAssetId,
    full_song_asset_id: fullSongAssetId,
    beat_file_url: beatSource,
    vocal_source: vocalSource,
    beat_source: beatSource,
    genre,
    daw,
    matchScore: makeMatchScore(collisions, pockets),
    summary: makeSummary(collisions, pockets),
    explanation: plainExplanation(collisions, daw),
    collisions,
    pockets,
    eq_cuts: [],
    audio_service_status: service.status,
    fallback_used: service.status !== "ok" || usedClientSpectrum,
    fallback_reason:
      service.status !== "ok"
        ? service.reason
        : usedClientSpectrum
          ? "Frequency curves came from the browser decoder because the audio service did not return spectral curves."
          : null,
  };

  const response: MixRoomFormResponse = {
    report,
    spectrum: {
      vocal: vocalSpectrum,
      beat: beatSpectrum,
    },
    audio_service_status: report.audio_service_status ?? service.status,
    fallback_used: report.fallback_used ?? false,
    fallback_reason: report.fallback_reason ?? null,
  };

  return NextResponse.json(response);
}

async function handleLegacyExplanation(req: NextRequest) {
  const body = (await req.json()) as MixRoomRequest;
  const daw = body.daw || "Logic Pro";
  const genre = body.genre || "rap";
  const topCollisions = Array.isArray(body.collisions)
    ? body.collisions.slice(0, 3)
    : [];

  if (topCollisions.length === 0) {
    return NextResponse.json({
      explanation: fallbackExplanation([], daw),
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      explanation: fallbackExplanation(topCollisions, daw),
    });
  }

  const prompt = `These are frequency collision zones between a ${genre} vocal and beat:
${JSON.stringify(topCollisions)}

In 2 short sentences, explain to a rapper what this means and exactly what to do on the vocal channel.
Use plain English. No jargon. Mention ${pluginForDaw(daw)} for ${daw}.
Return only the explanation text, no JSON.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 180,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });

    const firstContent = msg.content[0];
    const explanation =
      firstContent?.type === "text" ? firstContent.text.trim() : "";

    return NextResponse.json({
      explanation: explanation || fallbackExplanation(topCollisions, daw),
    });
  } catch (apiError) {
    console.warn("Mix room Claude explanation failed:", apiError);
    return NextResponse.json({
      explanation: fallbackExplanation(topCollisions, daw),
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return handleFormAnalysis(req);
    }

    return handleLegacyExplanation(req);
  } catch (error: unknown) {
    console.error("Mix room analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mix room failed" },
      { status: 500 }
    );
  }
}
