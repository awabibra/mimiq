import io
import re
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import librosa
import soundfile as sf
from scipy import signal
from fastapi import BackgroundTasks, FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    import pyloudnorm as pyln
    _pyln_available = True
except ImportError:
    _pyln_available = False

class AudioMetrics(BaseModel):
    lufs: float
    dynamic_range: float
    spectral_centroid: float   # Hz (not kHz)
    peak_db: float
    true_peak_db: float
    rms_db: float
    spectral_flatness: float
    zero_crossing_rate: float
    duration: float
    # Metadata fields
    sample_rate: Optional[int] = None
    bit_depth: Optional[int] = None
    channels: Optional[int] = None
    # Measured spectral/dynamic fields
    noise_floor_db: float
    sibilance_peak: float
    dynamic_inconsistency: float
    harshness: float
    low_mid_buildup: float
    stereo_width: Optional[float]
    crest_factor: float
    # Advanced Hard Trap / PRO metrics
    stereo_width_lows: Optional[float] = None
    stereo_width_mids: Optional[float] = None
    stereo_width_highs: Optional[float] = None
    presence_boost_db: float = 0.0
    hpf_cutoff_hz: float = 100.0
    dynamic_ceiling_db: float = 0.0
    dynamic_floor_db: Optional[float] = None
    compression_ratio_proxy: float = 4.0
    resonance_peaks: list[float] = []
    estimated_attack_ms: float = 10.0
    estimated_release_ms: float = 100.0
    rt60_decay_proxy: float = 0.0
    saturation_index: float = 0.0
    adlib_lufs_delta: Optional[float] = None

class FrequencyCollision(BaseModel):
    start_seconds: float
    end_seconds: float
    frequency_low_hz: float
    frequency_high_hz: float
    vocal_energy_db: float
    beat_energy_db: float
    masking_delta_db: float
    analysis_version: str = "temporal_masking_v2"

class RecordingEvidence(BaseModel):
    kind: str
    start_seconds: float
    end_seconds: float
    delta_db: float
    baseline_db: float
    measured_db: float
    frequency_low_hz: Optional[float] = None
    frequency_high_hz: Optional[float] = None
    analysis_version: str = "recording_events_v2"

class AnalysisResponse(BaseModel):
    vocal: AudioMetrics
    beat: Optional[AudioMetrics] = None
    frequency_collisions: list[FrequencyCollision] = []
    recording_events: list[RecordingEvidence] = []

class VocalDiagnosticResponse(BaseModel):
    detectedKey: str
    bpm: float
    inKeyVoicedFrameRatio: Optional[float]
    medianPitchDeviationCents: Optional[float]
    voicedFrameCount: int
    pitchDriftMap: list[list[float]]
    retuneSpeed: str
    recommendedScale: str
    humanize: int
    tuneMode: str
    tuneReason: str
    chordProgression: str
    summary: str
    analysisVersion: str = "vocal_check_v3"

STEM_NAMES = ("vocals", "instrumental", "drums", "bass", "piano", "guitar", "other")
STEM_MODE_ORDER = {
    2: ("vocals", "instrumental"),
    4: ("vocals", "drums", "bass", "other"),
    6: ("vocals", "drums", "bass", "piano", "guitar", "other"),
}
ALLOWED_STEM_FORMATS = {".wav", ".mp3", ".flac"}
DEFAULT_STEM_MODE = 4
DEFAULT_STEM_MODEL = "htdemucs"
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

def estimate_remaining_ms(progress: float, started_at: Optional[str]) -> Optional[float]:
    if started_at is None or not progress or progress <= 0:
        return None

    try:
        started = datetime.fromisoformat(started_at)
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    except ValueError:
        return None

    if progress >= 100:
        return 0.0

    ratio = progress / 100.0
    if ratio <= 0:
        return None

    remaining = elapsed * (1 - ratio) / ratio
    return round(max(0.0, remaining), 2)

def stem_mode_from_request(requested_mode: int) -> tuple[str, ...]:
    return STEM_MODE_ORDER.get(requested_mode, STEM_MODE_ORDER[DEFAULT_STEM_MODE])

def parse_bit_depth(subtype: str | None) -> int | None:
    if not subtype:
        return None

    match = re.search(r"(\d+)", subtype)
    return int(match.group(1)) if match else None

def extract_metadata_from_bytes(file_bytes: bytes) -> dict:
    try:
        # For standard WAV/FLAC files sf.info can read straight from bytes
        info = sf.info(io.BytesIO(file_bytes))
        return {
            "sample_rate": info.samplerate,
            "channels": info.channels,
            "bit_depth": parse_bit_depth(info.subtype),
        }
    except Exception:
        # Fallback to temp file if format is tricky (e.g. mp3)
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=True) as temp:
                temp.write(file_bytes)
                temp.flush()
                info = sf.info(temp.name)
                return {
                    "sample_rate": info.samplerate,
                    "channels": info.channels,
                    "bit_depth": parse_bit_depth(info.subtype),
                }
        except Exception:
            return {}

def collect_stem_metadata(path: Path) -> dict:
    info = sf.info(str(path))
    duration = round(float(info.frames / max(1, info.samplerate)), 3)
    return {
        "duration_s": round(duration, 3),
        "sample_rate": info.samplerate,
        "bit_depth": parse_bit_depth(info.subtype),
        "channels": info.channels,
    }

def collect_source_metadata(path: Path) -> dict:
    info = sf.info(str(path))
    duration = round(float(info.frames / max(1, info.samplerate)), 3)
    return {
        "duration": round(duration, 3),
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "bpm": None,
        "bit_depth": parse_bit_depth(info.subtype),
    }

def compute_source_bpm(path: Path) -> float | None:
    try:
        samples, sample_rate = load_audio_bytes(path.read_bytes(), duration=None)
        bpm = librosa.beat.tempo(y=samples, sr=sample_rate)
        bpm_value = float(np.atleast_1d(bpm)[0]) if bpm is not None else None
        return round(bpm_value, 1) if bpm_value is not None and bpm_value > 1.0 else None
    except Exception:
        return None

def public_job(job_id: str, job: dict) -> dict:
    progress = float(job.get("progress", 0) or 0)
    started_at = job.get("started_at")
    estimated_remaining_seconds = estimate_remaining_ms(progress, started_at)
    stage = job.get("stage") or "Ready"

    response = {
        "job_id": job_id,
        "status": job["status"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "progress": min(100, max(0, int(progress))),
        "stage": stage,
        "requested_mode": job.get("requested_mode", DEFAULT_STEM_MODE),
        "requested_model": job.get("requested_model", DEFAULT_STEM_MODEL),
        "source_filename": job["source_filename"],
        "estimated_remaining_seconds": estimated_remaining_seconds,
    }

    if job.get("message"):
        response["message"] = job["message"]
    if job.get("error"):
        response["error"] = job["error"]
    if job.get("source"):
        response["source"] = job["source"]
    if job.get("fallback"):
        response["fallback"] = job["fallback"]
    if job.get("stems"):
        response["stems"] = job["stems"]

    return response

def update_stem_job(job_id: str, **patch: object) -> None:
    with stem_job_lock:
        if job_id in stem_jobs:
            stem_jobs[job_id].update(patch)
            stem_jobs[job_id]["updated_at"] = utc_now()

def build_demucs_command(
    input_path: Path,
    output_dir: Path,
    requested_mode: int,
    requested_model: str,
) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        requested_model,
    ]
    if requested_mode == 2:
        command.extend(["--two-stems", "vocals"])
    command.extend(["--out", str(output_dir), str(input_path)])
    return command

def run_stem_split(
    job_id: str,
    input_path: Path,
    job_dir: Path,
    requested_mode: int,
    requested_model: str,
) -> None:
    requested_stems = stem_mode_from_request(requested_mode)
    update_stem_job(
        job_id,
        status="processing",
        progress=4,
        stage="initializing",
        message="Preparing demucs split job.",
        requested_mode=requested_mode,
        requested_model=requested_model,
        started_at=utc_now(),
    )

    try:
        output_dir = job_dir / "separated"
        stems_dir = job_dir / "stems"
        stems_dir.mkdir(parents=True, exist_ok=True)

        source_meta = collect_source_metadata(input_path)
        source_meta["bpm"] = compute_source_bpm(input_path)
        update_stem_job(job_id, source=source_meta)

        update_stem_job(
            job_id,
            progress=20,
            stage="split_started",
            message="Demucs processing started.",
        )

        cmd = build_demucs_command(
            input_path,
            output_dir,
            requested_mode,
            requested_model,
        )
        result = subprocess.run(
            cmd,
            capture_output=True,
            check=False,
            text=True,
            timeout=1200,
        )

        if result.returncode != 0:
            message = (result.stderr or result.stdout or "Demucs failed.").strip()
            raise RuntimeError(message[-1200:])

        update_stem_job(job_id, progress=80, stage="collecting", message="Collecting stems.")

        available_stems: list[str] = []
        for stem in STEM_NAMES:
            source_name = "no_vocals" if stem == "instrumental" else stem
            if list(output_dir.rglob(f"{source_name}.wav")):
                available_stems.append(stem)

        delivered_stems = [stem for stem in requested_stems if stem in available_stems]
        if not delivered_stems:
            raise RuntimeError("No requested stems were produced by demucs.")

        delivered_mode = len(delivered_stems)
        fallback = None
        if delivered_mode < len(requested_stems):
            fallback = {
                "requested_mode": requested_mode,
                "requested_model": requested_model,
                "requested_stems": list(requested_stems),
                "delivered_mode": max(delivered_mode, 0),
                "delivered_stems": delivered_stems,
                "available_stems": available_stems,
                "reason": "Requested stem mode is unavailable on this host.",
            }

        stems: dict[str, dict[str, str]] = {}
        for stem in delivered_stems:
            source_name = "no_vocals" if stem == "instrumental" else stem
            matches = sorted(output_dir.rglob(f"{source_name}.wav"))
            if not matches:
                raise RuntimeError(f"Demucs output missing {stem}.wav.")

            stable_path = stems_dir / f"{stem}.wav"
            shutil.copyfile(matches[0], stable_path)
            file_meta = collect_stem_metadata(stable_path)
            stems[stem] = {
                "name": stem,
                "filename": f"{stem}.wav",
                "url": stem_download_url(job_id, stem),
                "fileMeta": file_meta,
            }

        update_stem_job(
            job_id,
            status="complete",
            progress=100,
            stage="complete",
            message="Stem split complete.",
            fallback=fallback,
            stems=stems,
        )
    except Exception as exc:
        update_stem_job(
            job_id,
            status="failed",
            message="Stem separation failed.",
            error=str(exc),
        )

def load_audio_bytes(file_bytes: bytes, duration: Optional[float] = 60.0) -> tuple[np.ndarray, int]:
    buf = io.BytesIO(file_bytes)
    try:
        kwargs = {"sr": None, "mono": True}
        if duration is not None:
            kwargs["duration"] = duration
        y, sr = librosa.load(buf, **kwargs)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not decode audio: {str(e)}")
    return y, sr

def _biquad_high_shelf(sr: int) -> tuple[np.ndarray, np.ndarray]:
    gain_db = 3.999843853973347
    frequency = 1681.974450955533
    q = 0.7071752369554196
    amplitude = 10 ** (gain_db / 40.0)
    omega = 2 * np.pi * frequency / sr
    alpha = np.sin(omega) / (2 * q)
    cos_omega = np.cos(omega)
    sqrt_amplitude = np.sqrt(amplitude)
    b = np.array([
        amplitude * ((amplitude + 1) + (amplitude - 1) * cos_omega + 2 * sqrt_amplitude * alpha),
        -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cos_omega),
        amplitude * ((amplitude + 1) + (amplitude - 1) * cos_omega - 2 * sqrt_amplitude * alpha),
    ])
    a = np.array([
        (amplitude + 1) - (amplitude - 1) * cos_omega + 2 * sqrt_amplitude * alpha,
        2 * ((amplitude - 1) - (amplitude + 1) * cos_omega),
        (amplitude + 1) - (amplitude - 1) * cos_omega - 2 * sqrt_amplitude * alpha,
    ])
    return b / a[0], a / a[0]

def _biquad_high_pass(sr: int) -> tuple[np.ndarray, np.ndarray]:
    frequency = 38.13547087602444
    q = 0.5003270373238773
    omega = 2 * np.pi * frequency / sr
    alpha = np.sin(omega) / (2 * q)
    cos_omega = np.cos(omega)
    b = np.array([(1 + cos_omega) / 2, -(1 + cos_omega), (1 + cos_omega) / 2])
    a = np.array([1 + alpha, -2 * cos_omega, 1 - alpha])
    return b / a[0], a / a[0]

def compute_bs1770_loudness(y: np.ndarray, sr: int) -> float:
    """Mono BS.1770 gated loudness using the standard K-weighting stages."""
    samples = np.asarray(y, dtype=np.float64)
    if samples.size == 0 or not np.any(np.abs(samples) > 1e-12):
        return -70.0

    shelf_b, shelf_a = _biquad_high_shelf(sr)
    high_pass_b, high_pass_a = _biquad_high_pass(sr)
    weighted = signal.lfilter(high_pass_b, high_pass_a, signal.lfilter(shelf_b, shelf_a, samples))
    block_size = max(1, int(round(0.4 * sr)))
    step = max(1, int(round(0.1 * sr)))
    if weighted.size < block_size:
        weighted = np.pad(weighted, (0, block_size - weighted.size))

    starts = range(0, weighted.size - block_size + 1, step)
    block_energy = np.array([
        float(np.mean(weighted[start:start + block_size] ** 2))
        for start in starts
    ])
    block_loudness = -0.691 + 10 * np.log10(np.maximum(block_energy, 1e-20))
    absolute = block_energy[block_loudness >= -70.0]
    if absolute.size == 0:
        return -70.0

    relative_threshold = -0.691 + 10 * np.log10(np.mean(absolute)) - 10.0
    gated = block_energy[(block_loudness >= -70.0) & (block_loudness >= relative_threshold)]
    if gated.size == 0:
        return -70.0
    return round(float(-0.691 + 10 * np.log10(np.mean(gated))), 1)

def compute_lufs(y: np.ndarray, sr: int) -> float:
    # pyloudnorm and the local path implement the same BS.1770 gating model.
    if _pyln_available:
        try:
            meter = pyln.Meter(sr)
            lufs = meter.integrated_loudness(y.astype(np.float64))
            if np.isfinite(lufs) and lufs > -70.0:
                return round(float(lufs), 1)
        except Exception:
            pass
    return compute_bs1770_loudness(y, sr)

def compute_true_peak(y: np.ndarray) -> float:
    if y.size == 0:
        return -70.0
    oversampled = signal.resample_poly(np.asarray(y, dtype=np.float64), 4, 1)
    peak = float(np.max(np.abs(oversampled)))
    return round(float(20 * np.log10(max(peak, 1e-10))), 1)

def compute_metrics(y: np.ndarray, sr: int) -> AudioMetrics:
    # LUFS
    lufs = compute_lufs(y, sr)

    # Peak dB
    peak = float(np.max(np.abs(y)))
    peak_db = round(20 * np.log10(peak + 1e-10), 1)
    true_peak_db = compute_true_peak(y)

    # RMS dB
    rms = float(np.sqrt(np.mean(y ** 2)))
    rms_db = round(20 * np.log10(rms + 1e-10), 1)

    # Dynamic range: percentile spread of frame dB
    frame_rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    frame_db = 20 * np.log10(frame_rms + 1e-10)
    sorted_db = np.sort(frame_db)
    n = len(sorted_db)
    top_10 = float(np.mean(sorted_db[int(n * 0.9):])) if n > 10 else float(sorted_db[-1])
    bot_10 = float(np.mean(sorted_db[:max(1, int(n * 0.1))]))
    dynamic_range = round(top_10 - bot_10, 1)

    # Keep this in Hz because the frontend expects it.
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    centroid_hz = round(float(np.mean(centroid)), 1)

    # Spectral flatness (tonality: 0=tonal, 1=noise)
    flatness = librosa.feature.spectral_flatness(y=y)[0]
    spec_flat = round(float(np.mean(flatness)), 4)

    # Zero crossing rate
    zcr = librosa.feature.zero_crossing_rate(y=y)[0]
    zcr_mean = round(float(np.mean(zcr)), 4)

    duration = round(float(len(y) / sr), 2)

    # STFT for frequency-band analysis
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)

    # Noise floor: 5th percentile of frame dB (captures breath / room tone)
    noise_floor_db = round(float(np.clip(np.percentile(frame_db, 5), -80.0, -20.0)), 1)

    # Sibilance peak: RMS energy in 5-10 kHz band, as dBFS
    sib_mask = (freqs >= 5000) & (freqs <= 10000)
    sib_S = S[sib_mask, :]
    if sib_S.size > 0:
        sib_rms = float(np.sqrt(np.mean(sib_S ** 2)))
        sibilance_peak = round(20 * np.log10(sib_rms + 1e-10), 1)
    else:
        sibilance_peak = -30.0

    # Harshness: mean spectral power in the 2-5 kHz presence zone
    harsh_mask = (freqs >= 2000) & (freqs <= 5000)
    harsh_S = S[harsh_mask, :]
    harshness = float(np.mean(harsh_S ** 2)) if harsh_S.size > 0 else 0.0

    # Low-mid buildup: mean spectral power in 200-500 Hz
    low_mid_mask = (freqs >= 200) & (freqs <= 500)
    low_mid_S = S[low_mid_mask, :]
    low_mid_buildup = float(np.mean(low_mid_S ** 2)) if low_mid_S.size > 0 else 0.0

    # Dynamic inconsistency: coefficient of variation of voiced frame RMS
    voiced_rms = frame_rms[frame_rms > 1e-6]
    if len(voiced_rms) > 1:
        dyn_inconsistency = round(
            float(np.std(voiced_rms)) / (float(np.mean(voiced_rms)) + 1e-10), 4
        )
    else:
        dyn_inconsistency = 0.0

    # Crest Factor: Peak to RMS ratio
    crest_factor = round(max(0.0, peak_db - rms_db), 2)

    # 30-band 1/3-octave smoothed spectral envelope (100Hz - 16kHz)
    mel_basis = librosa.filters.mel(sr=sr, n_fft=2048, n_mels=30, fmin=100.0, fmax=16000.0)
    mel_S = np.dot(mel_basis, S)
    mel_mean = np.mean(mel_S, axis=1)
    envelope_db = 20 * np.log10(np.maximum(1e-10, mel_mean))
    spectral_envelope = [round(float(x), 2) for x in envelope_db]

    # Presence Target Curve (3-5kHz) vs Fundamental (200-1000Hz)
    presence_mask = (freqs >= 3000) & (freqs <= 5000)
    fund_mask = (freqs >= 200) & (freqs <= 1000)
    presence_energy = np.mean(S[presence_mask, :] ** 2) if np.any(presence_mask) else 1e-10
    fund_energy = np.mean(S[fund_mask, :] ** 2) if np.any(fund_mask) else 1e-10
    presence_boost_db = round(10 * np.log10(presence_energy / fund_energy + 1e-10), 2)

    # HPF Rolloff Detection (Scan 60-150Hz for sharp spectral slope)
    hpf_cutoff_hz = 100.0
    low_idx = np.where((freqs >= 40) & (freqs <= 180))[0]
    if len(low_idx) > 2:
        low_energies = 20 * np.log10(np.mean(np.abs(S[low_idx, :]), axis=1) + 1e-10)
        # Find where energy drops by >6dB from the peak in this region
        peak_energy = np.max(low_energies)
        for i in reversed(range(len(low_idx))):
            if low_energies[i] < peak_energy - 12:
                hpf_cutoff_hz = round(float(freqs[low_idx[i]]), 1)
                break

    # Dynamic Range Fingerprint
    dynamic_ceiling_db = round(float(np.percentile(frame_db, 95)), 1)
    active_dynamic_frames = frame_db[frame_db > noise_floor_db + 5]
    dynamic_floor_db = (
        round(float(np.percentile(active_dynamic_frames, 5)), 1)
        if active_dynamic_frames.size > 0
        else None
    )

    # Compression Ratio Proxy
    # Peak variance vs RMS variance.
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    peak_variance = np.std(onset_env)
    rms_variance = np.std(frame_rms)
    ratio_proxy = round(float(np.clip((peak_variance / (rms_variance + 1e-5)) * 2, 2.0, 20.0)), 1)

    # Resonance / Boxiness Detection
    box_mask = (freqs >= 200) & (freqs <= 600)
    resonance_peaks = []
    if np.any(box_mask):
        box_S = np.mean(S[box_mask, :], axis=1)
        import scipy.signal
        peaks, _ = scipy.signal.find_peaks(box_S, prominence=np.max(box_S)*0.2)
        box_freqs = freqs[box_mask]
        for p in peaks:
            resonance_peaks.append(round(float(box_freqs[p]), 1))

    # Transient Profiling (Estimated Attack / Release)
    # Fast attack if onsets are very sharp
    estimated_attack_ms = round(float(np.clip(20.0 / (np.max(onset_env) + 1e-5), 1.0, 30.0)), 1)
    estimated_release_ms = round(float(np.clip(100.0 * (1.0 / (rms_variance + 1e-5)), 30.0, 500.0)), 1)

    # Bleed-Resistant RT60 Estimation
    # Find gaps where RMS drops > 20dB below peak but is above noise floor (reverb tail)
    peak_rms_db = np.max(frame_db)
    tail_mask = (frame_db < peak_rms_db - 15) & (frame_db > noise_floor_db + 3)
    if np.any(tail_mask):
        rt60_decay_proxy = round(float(np.clip(np.sum(tail_mask) * (512 / sr) * 0.5, 0.1, 3.0)), 2)
    else:
        rt60_decay_proxy = 0.5

    # Saturation Index Proxy
    # HNR (Harmonic-to-Noise Ratio) or Spectral Rolloff proxy
    rolloff = np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85))
    saturation_index = round(float(np.clip(rolloff / 1000.0, 0.0, 10.0)), 2)

    return AudioMetrics(
        lufs=lufs,
        dynamic_range=dynamic_range,
        spectral_centroid=centroid_hz,
        peak_db=peak_db,
        true_peak_db=true_peak_db,
        rms_db=rms_db,
        spectral_flatness=spec_flat,
        zero_crossing_rate=zcr_mean,
        duration=duration,
        noise_floor_db=noise_floor_db,
        sibilance_peak=sibilance_peak,
        dynamic_inconsistency=dyn_inconsistency,
        harshness=harshness,
        low_mid_buildup=low_mid_buildup,
        stereo_width=None,
        crest_factor=crest_factor,
        spectral_envelope=spectral_envelope,
        stereo_width_lows=None,
        stereo_width_mids=None,
        stereo_width_highs=None,
        presence_boost_db=presence_boost_db,
        hpf_cutoff_hz=hpf_cutoff_hz,
        dynamic_ceiling_db=dynamic_ceiling_db,
        dynamic_floor_db=dynamic_floor_db,
        compression_ratio_proxy=ratio_proxy,
        resonance_peaks=resonance_peaks[:3],
        estimated_attack_ms=estimated_attack_ms,
        estimated_release_ms=estimated_release_ms,
        rt60_decay_proxy=rt60_decay_proxy,
        saturation_index=saturation_index,
        adlib_lufs_delta=None
    )

def compute_stereo_width(file_bytes: bytes, sr_ref: int) -> dict:
    """Returns overall and multi-band stereo width, plus adlib level delta."""
    try:
        buf = io.BytesIO(file_bytes)
        y_stereo, sr = librosa.load(buf, sr=sr_ref, mono=False, duration=60.0)
        if y_stereo.ndim < 2 or y_stereo.shape[0] < 2:
            return {"stereo_width": None, "lows": None, "mids": None, "highs": None, "adlib_lufs_delta": None}
        L = y_stereo[0].astype(np.float64)
        R = y_stereo[1].astype(np.float64)
        mid = (L + R) / 2
        side = (L - R) / 2

        def calc_width(m, s):
            with np.errstate(over="ignore", invalid="ignore"):
                m_rms = float(np.sqrt(np.mean(np.square(m))))
                s_rms = float(np.sqrt(np.mean(np.square(s))))
            if not np.isfinite(m_rms) or not np.isfinite(s_rms):
                return None
            return round(float(np.clip(s_rms / max(m_rms, 1e-12), 0.0, 1.0)), 4)

        overall_width = calc_width(mid, side)

        def apply_bandpass(data, low_cut, high_cut, fs):
            nyq = 0.5 * fs
            if low_cut >= nyq or high_cut >= nyq or low_cut >= high_cut:
                return None
            sos = signal.butter(
                4,
                [low_cut / nyq, high_cut / nyq],
                btype="bandpass",
                output="sos",
            )
            filtered = signal.sosfilt(sos, data)
            return filtered if np.all(np.isfinite(filtered)) else None

        def band_width(low_cut, high_cut):
            filtered_mid = apply_bandpass(mid, low_cut, high_cut, sr)
            filtered_side = apply_bandpass(side, low_cut, high_cut, sr)
            if filtered_mid is None or filtered_side is None:
                return None
            return calc_width(filtered_mid, filtered_side)

        lows_width = band_width(20, 250)
        mids_width = band_width(250, 4000)
        highs_width = band_width(4000, min(16000, sr / 2 - 100))

        # Ad-lib detection proxy (loud mono = lead, quiet wide = adlib)
        frame_len = 2048
        hop_len = 512
        mid_rms = librosa.feature.rms(y=mid, frame_length=frame_len, hop_length=hop_len)[0]
        side_rms = librosa.feature.rms(y=side, frame_length=frame_len, hop_length=hop_len)[0]
        width_ratio = (side_rms + 1e-10) / (mid_rms + 1e-10)

        threshold = np.max(mid_rms) * 0.1
        lead_frames = (width_ratio < 0.25) & (mid_rms > threshold)
        adlib_frames = (width_ratio > 0.35) & (mid_rms > threshold)

        adlib_lufs_delta = None
        if np.any(lead_frames) and np.any(adlib_frames):
            lead_db = 20 * np.log10(np.mean(mid_rms[lead_frames]) + 1e-10)
            adlib_db = 20 * np.log10(np.mean(mid_rms[adlib_frames]) + 1e-10)
            measured_delta = float(np.clip(adlib_db - lead_db, -15.0, 0.0))
            if np.isfinite(measured_delta):
                adlib_lufs_delta = round(measured_delta, 2)

        return {
            "stereo_width": overall_width,
            "lows": lows_width,
            "mids": mids_width,
            "highs": highs_width,
            "adlib_lufs_delta": adlib_lufs_delta
        }
    except Exception:
        return {"stereo_width": None, "lows": None, "mids": None, "highs": None, "adlib_lufs_delta": None}

OPTIONAL_METRIC_FIELDS = {
    "sample_rate",
    "bit_depth",
    "channels",
    "stereo_width",
    "stereo_width_lows",
    "stereo_width_mids",
    "stereo_width_highs",
    "dynamic_floor_db",
    "adlib_lufs_delta",
}

def validate_finite_metrics(metrics: AudioMetrics) -> AudioMetrics:
    for name, value in metrics.__dict__.items():
        if isinstance(value, (float, np.floating)) and not np.isfinite(value):
            if name in OPTIONAL_METRIC_FIELDS:
                setattr(metrics, name, None)
                continue
            raise HTTPException(
                status_code=422,
                detail=f"Required measurement '{name}' was not finite.",
            )
        if isinstance(value, list) and any(
            isinstance(item, (float, np.floating)) and not np.isfinite(item)
            for item in value
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Required measurement '{name}' contained a non-finite value.",
            )
    return metrics

def _band_energy_db(stft: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if not np.any(mask):
        return np.full(stft.shape[1], -120.0)
    band_rms = np.sqrt(np.mean((stft[mask, :] / 1024.0) ** 2, axis=0))
    return 20 * np.log10(np.maximum(band_rms, 1e-10))

def _event_segments(mask: np.ndarray, minimum_frames: int) -> list[np.ndarray]:
    indices = np.flatnonzero(mask)
    if indices.size == 0:
        return []
    split_points = np.where(np.diff(indices) > 1)[0] + 1
    return [segment for segment in np.split(indices, split_points) if segment.size >= minimum_frames]

def detect_recording_evidence(vocal: np.ndarray, sr: int) -> list[RecordingEvidence]:
    if vocal.size < 2048:
        return []

    n_fft = 2048
    hop = 512
    magnitude = np.abs(librosa.stft(vocal, n_fft=n_fft, hop_length=hop))
    frequencies = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    frame_rms = librosa.feature.rms(y=vocal, frame_length=n_fft, hop_length=hop)[0]
    frame_count = min(magnitude.shape[1], frame_rms.size)
    magnitude = magnitude[:, :frame_count]
    level_db = 20 * np.log10(np.maximum(frame_rms[:frame_count], 1e-10))
    active_floor = max(-60.0, float(np.percentile(level_db, 35)))
    active = level_db > active_floor
    if not np.any(active):
        return []

    frame_seconds = hop / sr
    duration = vocal.size / sr
    minimum_frames = max(2, int(np.ceil(0.15 / frame_seconds)))
    events: list[RecordingEvidence] = []
    bands = (
        ("presence_spike", 2000.0, 5000.0, 6.0),
        ("low_mid_buildup", 180.0, 500.0, 5.0),
        ("sibilance_spike", 5000.0, 10000.0, 6.0),
    )

    for kind, low, high, threshold_db in bands:
        band_mask = (frequencies >= low) & (frequencies < min(high, sr / 2))
        if not np.any(band_mask):
            continue
        band_db = _band_energy_db(magnitude, band_mask)
        baseline = float(np.median(band_db[active]))
        for segment in _event_segments(active & (band_db >= baseline + threshold_db), minimum_frames):
            measured = float(np.mean(band_db[segment]))
            delta = measured - baseline
            if not all(np.isfinite(value) for value in (baseline, measured, delta)):
                continue
            events.append(RecordingEvidence(
                kind=kind,
                start_seconds=round(float(segment[0] * frame_seconds), 3),
                end_seconds=round(float(min(duration, (segment[-1] + 1) * frame_seconds)), 3),
                delta_db=round(delta, 2),
                baseline_db=round(baseline, 2),
                measured_db=round(measured, 2),
                frequency_low_hz=low,
                frequency_high_hz=min(high, sr / 2),
            ))

    level_baseline = float(np.median(level_db[active]))
    level_delta = level_db - level_baseline
    for segment in _event_segments(active & (np.abs(level_delta) >= 6.0), minimum_frames):
        measured = float(np.mean(level_db[segment]))
        delta = measured - level_baseline
        if not all(np.isfinite(value) for value in (level_baseline, measured, delta)):
            continue
        events.append(RecordingEvidence(
            kind="level_inconsistency",
            start_seconds=round(float(segment[0] * frame_seconds), 3),
            end_seconds=round(float(min(duration, (segment[-1] + 1) * frame_seconds)), 3),
            delta_db=round(delta, 2),
            baseline_db=round(level_baseline, 2),
            measured_db=round(measured, 2),
        ))

    events.sort(key=lambda event: abs(event.delta_db), reverse=True)
    return events[:16]

def detect_temporal_collisions(
    vocal: np.ndarray,
    vocal_sr: int,
    beat: np.ndarray,
    beat_sr: int,
) -> list[FrequencyCollision]:
    if beat_sr != vocal_sr:
        beat = librosa.resample(beat, orig_sr=beat_sr, target_sr=vocal_sr)
    sample_count = min(len(vocal), len(beat))
    if sample_count < 2048:
        return []

    vocal = vocal[:sample_count]
    beat = beat[:sample_count]
    n_fft = 2048
    hop = 512
    vocal_stft = np.abs(librosa.stft(vocal, n_fft=n_fft, hop_length=hop))
    beat_stft = np.abs(librosa.stft(beat, n_fft=n_fft, hop_length=hop))
    frame_count = min(vocal_stft.shape[1], beat_stft.shape[1])
    vocal_stft = vocal_stft[:, :frame_count]
    beat_stft = beat_stft[:, :frame_count]
    frequencies = librosa.fft_frequencies(sr=vocal_sr, n_fft=n_fft)
    frame_seconds = hop / vocal_sr
    minimum_frames = max(2, int(np.ceil(0.3 / frame_seconds)))
    bands = ((120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 12000))
    findings: list[FrequencyCollision] = []

    for low, high in bands:
        band_mask = (frequencies >= low) & (frequencies < min(high, vocal_sr / 2))
        vocal_db = _band_energy_db(vocal_stft, band_mask)
        beat_db = _band_energy_db(beat_stft, band_mask)
        masking_delta = beat_db - vocal_db
        active = (vocal_db > -55.0) & (beat_db > -55.0) & (masking_delta > -6.0)

        indices = np.flatnonzero(active)
        if indices.size == 0:
            continue
        split_points = np.where(np.diff(indices) > 1)[0] + 1
        for segment in np.split(indices, split_points):
            if segment.size < minimum_frames:
                continue
            start_frame = int(segment[0])
            end_frame = int(segment[-1] + 1)
            findings.append(FrequencyCollision(
                start_seconds=round(start_frame * frame_seconds, 3),
                end_seconds=round(min(sample_count / vocal_sr, end_frame * frame_seconds), 3),
                frequency_low_hz=float(low),
                frequency_high_hz=float(min(high, vocal_sr / 2)),
                vocal_energy_db=round(float(np.mean(vocal_db[segment])), 2),
                beat_energy_db=round(float(np.mean(beat_db[segment])), 2),
                masking_delta_db=round(float(np.mean(masking_delta[segment])), 2),
            ))

    findings.sort(
        key=lambda finding: (
            finding.masking_delta_db,
            finding.end_seconds - finding.start_seconds,
        ),
        reverse=True,
    )
    return findings[:12]

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
) -> tuple[Optional[float], Optional[float], int, list[list[float]]]:
    hop_length = 512
    f0, voiced_flag, _voiced_prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sr,
        hop_length=hop_length,
    )

    if f0 is None or voiced_flag is None:
        return None, None, 0, []

    voiced = voiced_flag & np.isfinite(f0)
    pitches = f0[voiced]
    if len(pitches) == 0:
        return None, None, 0, []

    midi = librosa.hz_to_midi(pitches)
    nearest = np.rint(midi)
    pitch_classes = np.mod(nearest.astype(int), 12)
    in_key = np.array([pc in scale_pcs for pc in pitch_classes])
    cents_off = np.abs(midi - nearest) * 100
    in_key_rate = float(np.mean(in_key))
    median_deviation = float(np.median(cents_off))

    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop_length)
    voiced_indices = np.flatnonzero(voiced)
    stride = max(1, int(np.ceil(len(voiced_indices) / 240)))
    drift_map = [
        [round(float(times[index]), 3), round(float(f0[index]), 2)]
        for index in voiced_indices[::stride]
    ]

    return round(in_key_rate, 4), round(median_deviation, 2), int(len(pitches)), drift_map

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
    in_key_ratio: Optional[float],
    median_deviation_cents: Optional[float],
) -> tuple[str, str, int, str, str]:
    reliable_ratio = in_key_ratio if in_key_ratio is not None else 0.0
    reliable_deviation = median_deviation_cents if median_deviation_cents is not None else 50.0
    if bpm >= 130 or reliable_ratio < 0.55 or reliable_deviation > 28:
        retune_speed = "fast"
    elif bpm >= 95 or reliable_ratio < 0.76 or reliable_deviation > 16:
        retune_speed = "medium"
    else:
        retune_speed = "slow"

    tune_mode = "hard tune" if bpm >= 132 or reliable_ratio < 0.62 else "natural tune"

    if tune_mode == "hard tune":
        recommended_scale = "Chromatic"
        humanize = int(np.clip(round(20 - reliable_ratio * 16), 0, 20))
        reason = "Measured voiced frames leave the selected scale often enough that a faster starting point is worth auditioning."
    else:
        recommended_scale = detected_key
        humanize = int(np.clip(round(70 - reliable_ratio * 30), 40, 70))
        reason = "Most measured voiced frames align with the selected scale, so a slower, more natural starting point preserves movement."

    return retune_speed, recommended_scale, humanize, tune_mode, reason

def diagnostic_summary(
    detected_key: str,
    bpm: float,
    in_key_ratio: Optional[float],
    median_deviation_cents: Optional[float],
    tune_mode: str,
    retune_speed: str,
    recommended_scale: str,
    humanize: int,
    progression: str,
) -> str:
    if in_key_ratio is None or median_deviation_cents is None:
        pitch_note = "Pitch alignment could not be measured reliably."
    elif in_key_ratio >= 0.78 and median_deviation_cents <= 18:
        pitch_note = f"{in_key_ratio:.0%} of voiced frames are in key with a {median_deviation_cents:.0f}-cent median deviation."
    elif in_key_ratio >= 0.58:
        pitch_note = f"{in_key_ratio:.0%} of voiced frames are in key; median deviation is {median_deviation_cents:.0f} cents."
    else:
        pitch_note = f"Only {in_key_ratio:.0%} of measured voiced frames align with the detected scale."

    return (
        f"I hear this around {detected_key} at {bpm:.0f} BPM. "
        f"{pitch_note} Start with {tune_mode}: {retune_speed} retune speed, "
        f"{recommended_scale} scale, and Humanize around {humanize}. "
        f"If you need chords under it, try {progression} first."
    )

def diagnose_vocal_audio(y: np.ndarray, sr: int) -> VocalDiagnosticResponse:
    detected_key, root, mode, scale_pcs = detect_key(y, sr)
    bpm = detect_bpm(y, sr)
    in_key_ratio, median_deviation, voiced_frame_count, drift_map = pitch_diagnostics(y, sr, scale_pcs)
    retune_speed, scale, humanize, tune_mode, reason = tuning_recommendations(
        detected_key,
        bpm,
        in_key_ratio,
        median_deviation,
    )
    progression = chord_progression(root, mode)
    summary = diagnostic_summary(
        detected_key,
        bpm,
        in_key_ratio,
        median_deviation,
        tune_mode,
        retune_speed,
        scale,
        humanize,
        progression,
    )

    return VocalDiagnosticResponse(
        detectedKey=detected_key,
        bpm=bpm,
        inKeyVoicedFrameRatio=in_key_ratio,
        medianPitchDeviationCents=median_deviation,
        voicedFrameCount=voiced_frame_count,
        pitchDriftMap=drift_map,
        retuneSpeed=retune_speed,
        recommendedScale=scale,
        humanize=humanize,
        tuneMode=tune_mode,
        tuneReason=reason,
        chordProgression=progression,
        summary=summary,
    )

@app.post("/analyze", response_model=AnalysisResponse, response_model_exclude_none=True)
async def analyze(
    vocal: UploadFile = File(...),
    beat: Optional[UploadFile] = File(None),
):
    vocal_bytes = await vocal.read()
    if len(vocal_bytes) == 0:
        raise HTTPException(status_code=400, detail="Vocal file is empty")
    if len(vocal_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (50MB max)")

    y_vocal, sr_vocal = load_audio_bytes(vocal_bytes, duration=None)
    vocal_metrics = validate_finite_metrics(compute_metrics(y_vocal, sr_vocal))

    vocal_meta = extract_metadata_from_bytes(vocal_bytes)
    vocal_metrics.sample_rate = vocal_meta.get("sample_rate")
    vocal_metrics.channels = vocal_meta.get("channels")
    vocal_metrics.bit_depth = vocal_meta.get("bit_depth")

    stereo_data = compute_stereo_width(vocal_bytes, sr_vocal)
    if stereo_data.get("stereo_width") is not None:
        vocal_metrics.stereo_width = stereo_data["stereo_width"]
        vocal_metrics.stereo_width_lows = stereo_data["lows"]
        vocal_metrics.stereo_width_mids = stereo_data["mids"]
        vocal_metrics.stereo_width_highs = stereo_data["highs"]
        vocal_metrics.adlib_lufs_delta = stereo_data["adlib_lufs_delta"]
    vocal_metrics = validate_finite_metrics(vocal_metrics)

    beat_metrics = None
    collisions = []
    recording_events = detect_recording_evidence(y_vocal, sr_vocal)

    if beat and beat.filename:
        beat_bytes = await beat.read()
        if len(beat_bytes) > 0:
            y_beat, sr_beat = load_audio_bytes(beat_bytes, duration=None)
            beat_metrics = validate_finite_metrics(compute_metrics(y_beat, sr_beat))

            beat_meta = extract_metadata_from_bytes(beat_bytes)
            beat_metrics.sample_rate = beat_meta.get("sample_rate")
            beat_metrics.channels = beat_meta.get("channels")
            beat_metrics.bit_depth = beat_meta.get("bit_depth")

            beat_sw_data = compute_stereo_width(beat_bytes, sr_beat)
            if beat_sw_data.get("stereo_width") is not None:
                beat_metrics.stereo_width = beat_sw_data["stereo_width"]
                beat_metrics.stereo_width_lows = beat_sw_data["lows"]
                beat_metrics.stereo_width_mids = beat_sw_data["mids"]
                beat_metrics.stereo_width_highs = beat_sw_data["highs"]
            beat_metrics = validate_finite_metrics(beat_metrics)
            collisions = detect_temporal_collisions(
                y_vocal,
                sr_vocal,
                y_beat,
                sr_beat,
            )

    return AnalysisResponse(
        vocal=vocal_metrics,
        beat=beat_metrics,
        frequency_collisions=collisions,
        recording_events=recording_events,
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
    mode: int = Form(DEFAULT_STEM_MODE),
    model: str = Form(DEFAULT_STEM_MODEL),
):
    filename = audio.filename or "audio"
    suffix = Path(filename).suffix.lower()

    if mode not in {2, 4, 6}:
        raise HTTPException(status_code=400, detail="Stem mode must be 2, 4, or 6.")
    if suffix not in ALLOWED_STEM_FORMATS:
        raise HTTPException(status_code=415, detail="Upload a .wav, .mp3, or .flac file.")

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

    selected_model = (model or DEFAULT_STEM_MODEL).strip() or DEFAULT_STEM_MODEL

    with stem_job_lock:
        stem_jobs[job_id].update(
            {
                "requested_mode": mode,
                "requested_model": selected_model,
                "progress": 0,
                "stage": "queued",
                "source": collect_source_metadata(input_path),
            }
        )

    background_tasks.add_task(
        run_stem_split,
        job_id,
        input_path,
        job_dir,
        mode,
        selected_model,
    )
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

@app.get("/api/split-stems/{job_id}/zip")
async def download_stem_zip(job_id: str):
    with stem_job_lock:
        job = stem_jobs.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Stem split job not found.")
    if job.get("status") != "complete":
        raise HTTPException(status_code=409, detail="Stem split is not complete.")

    stems = job.get("stems")
    if not stems:
        raise HTTPException(status_code=404, detail="Stem files are unavailable.")

    stem_dir = STEM_JOB_ROOT / job_id / "stems"
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for stem_name in stems:
            file_path = stem_dir / f"{stem_name}.wav"
            if file_path.exists():
                zip_file.write(file_path, arcname=f"{stem_name}.wav")

    if zip_buffer.tell() == 0:
        raise HTTPException(status_code=404, detail="Stem files are unavailable.")

    zip_buffer.seek(0)
    safe_job = re.sub(r"[^a-zA-Z0-9_-]", "_", job_id)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_job}-stems.zip"',
            "Cache-Control": "no-store",
        },
    )

@app.get("/health")
async def health():
    return {"status": "ok"}
