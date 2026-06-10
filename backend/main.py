import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import librosa
import soundfile as sf
from fastapi import BackgroundTasks, FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class AudioMetrics(BaseModel):
    lufs: float
    dynamic_range: float
    spectral_centroid: float
    peak_db: float
    rms_db: float
    spectral_flatness: float
    zero_crossing_rate: float
    duration: float

class AnalysisResponse(BaseModel):
    vocal: AudioMetrics
    beat: Optional[AudioMetrics] = None
    frequency_collisions: list[dict] = []

class VocalDiagnosticResponse(BaseModel):
    detectedKey: str
    bpm: float
    pitchConsistencyScore: int
    pitchDriftMap: list[list[float]]
    retuneSpeed: str
    recommendedScale: str
    humanize: int
    tuneMode: str
    tuneReason: str
    chordProgression: str
    summary: str

STEM_NAMES = ("vocals", "drums", "bass", "other")
MAX_STEM_FILE_SIZE = 50 * 1024 * 1024
STEM_JOB_ROOT = Path(
    os.getenv("MIMIQ_STEM_JOB_DIR", Path(tempfile.gettempdir()) / "mimiq-stems")
)
stem_jobs: dict[str, dict] = {}
stem_job_lock = threading.Lock()

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
MAJOR_INTERVALS = (0, 2, 4, 5, 7, 9, 11)
MINOR_INTERVALS = (0, 2, 3, 5, 7, 8, 10)

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def stem_download_url(job_id: str, stem: str) -> str:
    return f"/api/split-stems/{job_id}/files/{stem}"

def public_job(job_id: str, job: dict) -> dict:
    response = {
        "job_id": job_id,
        "status": job["status"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "source_filename": job["source_filename"],
    }

    if job.get("message"):
        response["message"] = job["message"]
    if job.get("error"):
        response["error"] = job["error"]
    if job.get("stems"):
        response["stems"] = job["stems"]

    return response

def update_stem_job(job_id: str, **patch: object) -> None:
    with stem_job_lock:
        if job_id in stem_jobs:
            stem_jobs[job_id].update(patch)
            stem_jobs[job_id]["updated_at"] = utc_now()

def run_stem_split(job_id: str, input_path: Path, job_dir: Path) -> None:
    update_stem_job(
        job_id,
        status="processing",
        message="Separating stems with Demucs htdemucs.",
    )

    try:
        output_dir = job_dir / "separated"
        stems_dir = job_dir / "stems"
        stems_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable,
            "-m",
            "demucs.separate",
            "-n",
            "htdemucs",
            "--out",
            str(output_dir),
            str(input_path),
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            check=False,
            text=True,
        )

        if result.returncode != 0:
            message = (result.stderr or result.stdout or "Demucs failed.").strip()
            raise RuntimeError(message[-1200:])

        stems: dict[str, dict[str, str]] = {}
        for stem in STEM_NAMES:
            matches = sorted(output_dir.rglob(f"{stem}.wav"))
            if not matches:
                raise RuntimeError(f"Demucs did not produce {stem}.wav.")

            stable_path = stems_dir / f"{stem}.wav"
            shutil.copyfile(matches[0], stable_path)
            stems[stem] = {
                "name": stem,
                "filename": f"{stem}.wav",
                "url": stem_download_url(job_id, stem),
            }

        update_stem_job(
            job_id,
            status="complete",
            message="Stem split complete.",
            stems=stems,
        )
    except Exception as exc:
        update_stem_job(
            job_id,
            status="failed",
            message="Stem separation failed.",
            error=str(exc),
        )

def load_audio_bytes(file_bytes: bytes) -> tuple[np.ndarray, int]:
    buf = io.BytesIO(file_bytes)
    try:
        y, sr = librosa.load(buf, sr=None, mono=True, duration=60.0)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not decode audio: {str(e)}")
    return y, sr

def compute_lufs(y: np.ndarray, sr: int) -> float:
    # ITU-R BS.1770 approximation: K-weighting + gating
    # K-weighting stage 1: high-shelf pre-filter (simplified)
    from scipy import signal
    f0 = 1681.97
    Wn = float(f0 / (sr / 2))
    b, a = signal.butter(2, Wn, btype='high', output='ba')
    y_filtered = signal.lfilter(b, a, y)
    # Mean square with 400ms blocks, -10 LUFS gate
    block_size = int(0.4 * sr)
    if len(y_filtered) < block_size:
        block_size = len(y_filtered)
    squares = []
    for i in range(0, len(y_filtered) - block_size, block_size // 4):
        block = y_filtered[i:i + block_size]
        ms = np.mean(block ** 2)
        if ms > 0:
            squares.append(ms)
    if not squares:
        return -70.0
    mean_sq = np.mean(squares)
    lufs = -0.691 + 10 * np.log10(mean_sq + 1e-10)
    return round(float(lufs), 1)

def compute_metrics(y: np.ndarray, sr: int) -> AudioMetrics:
    # LUFS
    lufs = compute_lufs(y, sr)

    # Peak dB
    peak = np.max(np.abs(y))
    peak_db = round(float(20 * np.log10(peak + 1e-10)), 1)

    # RMS dB
    rms = np.sqrt(np.mean(y ** 2))
    rms_db = round(float(20 * np.log10(rms + 1e-10)), 1)

    # Dynamic range: difference between loud and quiet sections
    frame_rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    frame_db = 20 * np.log10(frame_rms + 1e-10)
    sorted_db = np.sort(frame_db)
    n = len(sorted_db)
    top_10 = np.mean(sorted_db[int(n * 0.9):]) if n > 10 else sorted_db[-1]
    bot_10 = np.mean(sorted_db[:max(1, int(n * 0.1))])
    dynamic_range = round(float(top_10 - bot_10), 1)

    # Spectral centroid (kHz)
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    centroid_khz = round(float(np.mean(centroid)) / 1000, 2)

    # Spectral flatness (tonality measure, 0=tonal, 1=noise)
    flatness = librosa.feature.spectral_flatness(y=y)[0]
    spec_flat = round(float(np.mean(flatness)), 4)

    # Zero crossing rate
    zcr = librosa.feature.zero_crossing_rate(y=y)[0]
    zcr_mean = round(float(np.mean(zcr)), 4)

    duration = round(float(len(y) / sr), 2)

    return AudioMetrics(
        lufs=lufs,
        dynamic_range=dynamic_range,
        spectral_centroid=centroid_khz,
        peak_db=peak_db,
        rms_db=rms_db,
        spectral_flatness=spec_flat,
        zero_crossing_rate=zcr_mean,
        duration=duration,
    )

def detect_collisions(vocal: AudioMetrics, beat: AudioMetrics) -> list[dict]:
    collisions = []
    # Spectral centroid proximity (both in similar frequency zone)
    diff = abs(vocal.spectral_centroid - beat.spectral_centroid)
    if diff < 0.8:
        severity = "HIGH" if diff < 0.3 else "MED"
        collisions.append({
            "zone": f"{vocal.spectral_centroid:.1f}kHz",
            "severity": severity,
            "description": "Vocal and beat centroids overlap — carve a notch in the beat at this frequency",
            "vocal_centroid": vocal.spectral_centroid,
            "beat_centroid": beat.spectral_centroid,
        })
    # Low-mid muddiness: both signals loud in low-mids
    if vocal.lufs > -20 and beat.lufs > -16 and vocal.spectral_centroid < 2.0:
        collisions.append({
            "zone": "200–400Hz",
            "severity": "MED",
            "description": "Low-mid buildup likely — high-pass vocal above 100Hz, reduce beat body",
            "vocal_centroid": vocal.spectral_centroid,
            "beat_centroid": beat.spectral_centroid,
        })
    return collisions

def normalize_vector(values: np.ndarray) -> np.ndarray:
    values = np.maximum(values.astype(float), 0)
    total = float(np.sum(values))
    if total <= 0:
        return np.ones_like(values) / len(values)
    return values / total

def detect_key(y: np.ndarray, sr: int) -> tuple[str, int, str, set[int]]:
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = normalize_vector(np.mean(chroma, axis=1))
    major_profile = normalize_vector(MAJOR_PROFILE)
    minor_profile = normalize_vector(MINOR_PROFILE)

    best_score = -1.0
    best_root = 0
    best_mode = "Major"

    for root in range(12):
        major_score = float(np.dot(chroma_mean, np.roll(major_profile, root)))
        minor_score = float(np.dot(chroma_mean, np.roll(minor_profile, root)))

        if major_score > best_score:
            best_score = major_score
            best_root = root
            best_mode = "Major"
        if minor_score > best_score:
            best_score = minor_score
            best_root = root
            best_mode = "Minor"

    intervals = MAJOR_INTERVALS if best_mode == "Major" else MINOR_INTERVALS
    scale_pcs = {(best_root + interval) % 12 for interval in intervals}
    return f"{NOTE_NAMES[best_root]} {best_mode}", best_root, best_mode, scale_pcs

def detect_bpm(y: np.ndarray, sr: int) -> float:
    tempo, _beats = librosa.beat.beat_track(y=y, sr=sr)
    tempo_value = float(np.asarray(tempo).reshape(-1)[0])
    return round(tempo_value, 1)

def pitch_diagnostics(
    y: np.ndarray,
    sr: int,
    scale_pcs: set[int],
) -> tuple[int, list[list[float]]]:
    hop_length = 512
    f0, voiced_flag, _voiced_prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sr,
        hop_length=hop_length,
    )

    if f0 is None or voiced_flag is None:
        return 0, []

    voiced = voiced_flag & np.isfinite(f0)
    pitches = f0[voiced]
    if len(pitches) == 0:
        return 0, []

    midi = librosa.hz_to_midi(pitches)
    nearest = np.rint(midi)
    pitch_classes = np.mod(nearest.astype(int), 12)
    in_key = np.array([pc in scale_pcs for pc in pitch_classes])
    cents_off = np.abs(midi - nearest) * 100
    in_key_rate = float(np.mean(in_key))
    tuning_score = max(0.0, 1.0 - min(float(np.mean(cents_off)), 50.0) / 50.0)
    score = int(round(np.clip((in_key_rate * 0.72 + tuning_score * 0.28) * 100, 0, 100)))

    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop_length)
    voiced_indices = np.flatnonzero(voiced)
    stride = max(1, int(np.ceil(len(voiced_indices) / 240)))
    drift_map = [
        [round(float(times[index]), 3), round(float(f0[index]), 2)]
        for index in voiced_indices[::stride]
    ]

    return score, drift_map

def chord_name(root: int, quality: str) -> str:
    return f"{NOTE_NAMES[root % 12]}m" if quality == "minor" else NOTE_NAMES[root % 12]

def chord_progression(root: int, mode: str) -> str:
    if mode == "Minor":
        chords = [
            chord_name(root, "minor"),
            chord_name(root + 3, "major"),
            chord_name(root + 10, "major"),
            chord_name(root + 5, "major"),
        ]
    else:
        chords = [
            chord_name(root, "major"),
            chord_name(root + 7, "major"),
            chord_name(root + 9, "minor"),
            chord_name(root + 5, "major"),
        ]

    return " - ".join(chords)

def tuning_recommendations(
    detected_key: str,
    bpm: float,
    pitch_score: int,
) -> tuple[str, str, int, str, str]:
    if bpm >= 130 or pitch_score < 55:
        retune_speed = "fast"
    elif bpm >= 95 or pitch_score < 76:
        retune_speed = "medium"
    else:
        retune_speed = "slow"

    tune_mode = "hard tune" if bpm >= 132 or pitch_score < 62 else "natural tune"

    if tune_mode == "hard tune":
        recommended_scale = "Chromatic"
        humanize = int(np.clip(round(20 - pitch_score / 6), 0, 20))
        reason = "Your vocal needs tighter snap, so chromatic hard tune will catch notes fast without asking for music theory homework."
    else:
        recommended_scale = detected_key
        humanize = int(np.clip(round(70 - pitch_score / 3), 40, 70))
        reason = "Your pitch is close enough to ride the song key, so a natural tune setting should clean it up without making it robotic."

    return retune_speed, recommended_scale, humanize, tune_mode, reason

def diagnostic_summary(
    detected_key: str,
    bpm: float,
    pitch_score: int,
    tune_mode: str,
    retune_speed: str,
    recommended_scale: str,
    humanize: int,
    progression: str,
) -> str:
    if pitch_score >= 78:
        pitch_note = "Your vocal is mostly landing in the right notes."
    elif pitch_score >= 58:
        pitch_note = "Your vocal has the idea, but a few notes wander."
    else:
        pitch_note = "Your vocal is drifting enough that tuning should be obvious and quick."

    return (
        f"I hear this around {detected_key} at {bpm:.0f} BPM. "
        f"{pitch_note} Start with {tune_mode}: {retune_speed} retune speed, "
        f"{recommended_scale} scale, and Humanize around {humanize}. "
        f"If you need chords under it, try {progression} first."
    )

def diagnose_vocal_audio(y: np.ndarray, sr: int) -> VocalDiagnosticResponse:
    detected_key, root, mode, scale_pcs = detect_key(y, sr)
    bpm = detect_bpm(y, sr)
    pitch_score, drift_map = pitch_diagnostics(y, sr, scale_pcs)
    retune_speed, scale, humanize, tune_mode, reason = tuning_recommendations(
        detected_key,
        bpm,
        pitch_score,
    )
    progression = chord_progression(root, mode)
    summary = diagnostic_summary(
        detected_key,
        bpm,
        pitch_score,
        tune_mode,
        retune_speed,
        scale,
        humanize,
        progression,
    )

    return VocalDiagnosticResponse(
        detectedKey=detected_key,
        bpm=bpm,
        pitchConsistencyScore=pitch_score,
        pitchDriftMap=drift_map,
        retuneSpeed=retune_speed,
        recommendedScale=scale,
        humanize=humanize,
        tuneMode=tune_mode,
        tuneReason=reason,
        chordProgression=progression,
        summary=summary,
    )

@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(
    vocal: UploadFile = File(...),
    beat: Optional[UploadFile] = File(None),
):
    vocal_bytes = await vocal.read()
    if len(vocal_bytes) == 0:
        raise HTTPException(status_code=400, detail="Vocal file is empty")
    if len(vocal_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (50MB max)")

    y_vocal, sr_vocal = load_audio_bytes(vocal_bytes)
    vocal_metrics = compute_metrics(y_vocal, sr_vocal)

    beat_metrics = None
    collisions = []

    if beat and beat.filename:
        beat_bytes = await beat.read()
        if len(beat_bytes) > 0:
            y_beat, sr_beat = load_audio_bytes(beat_bytes)
            beat_metrics = compute_metrics(y_beat, sr_beat)
            collisions = detect_collisions(vocal_metrics, beat_metrics)

    return AnalysisResponse(
        vocal=vocal_metrics,
        beat=beat_metrics,
        frequency_collisions=collisions,
    )

@app.post("/api/diagnose-vocal", response_model=VocalDiagnosticResponse)
async def diagnose_vocal(vocal: UploadFile = File(...)):
    filename = vocal.filename or "vocal"
    suffix = Path(filename).suffix.lower()

    if suffix not in {".wav", ".mp3"}:
        raise HTTPException(status_code=415, detail="Upload a .wav or .mp3 vocal.")

    vocal_bytes = await vocal.read()
    if len(vocal_bytes) == 0:
        raise HTTPException(status_code=400, detail="Vocal file is empty.")
    if len(vocal_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (50MB max).")

    y_vocal, sr_vocal = load_audio_bytes(vocal_bytes)
    if len(y_vocal) < sr_vocal:
        raise HTTPException(status_code=422, detail="Vocal file is too short to diagnose.")

    try:
        return diagnose_vocal_audio(y_vocal, sr_vocal)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not diagnose vocal: {str(exc)}")

@app.post("/api/split-stems")
async def split_stems(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
):
    filename = audio.filename or "audio"
    suffix = Path(filename).suffix.lower()

    if suffix not in {".wav", ".mp3"}:
        raise HTTPException(status_code=415, detail="Upload a .wav or .mp3 file.")

    file_bytes = await audio.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(file_bytes) > MAX_STEM_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (50MB max).")

    job_id = uuid.uuid4().hex
    job_dir = STEM_JOB_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / f"source{suffix}"
    input_path.write_bytes(file_bytes)

    now = utc_now()
    with stem_job_lock:
        stem_jobs[job_id] = {
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "source_filename": filename,
            "message": "Stem split queued.",
        }

    background_tasks.add_task(run_stem_split, job_id, input_path, job_dir)
    return public_job(job_id, stem_jobs[job_id])

@app.get("/api/split-stems/{job_id}")
async def get_stem_job(job_id: str):
    with stem_job_lock:
        job = stem_jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Stem split job not found.")

    return public_job(job_id, job)

@app.get("/api/split-stems/{job_id}/files/{stem}")
async def download_stem(job_id: str, stem: str):
    if stem not in STEM_NAMES:
        raise HTTPException(status_code=404, detail="Stem not found.")

    with stem_job_lock:
        job = stem_jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Stem split job not found.")
    if job.get("status") != "complete":
        raise HTTPException(status_code=409, detail="Stem split is not complete.")

    stem_path = STEM_JOB_ROOT / job_id / "stems" / f"{stem}.wav"
    if not stem_path.exists():
        raise HTTPException(status_code=404, detail="Stem file is unavailable.")

    return FileResponse(
        stem_path,
        filename=f"{stem}.wav",
        media_type="audio/wav",
    )

@app.get("/health")
async def health():
    return {"status": "ok"}
