# main.py
import io
import numpy as np
import librosa
import soundfile as sf
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

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

    # Spectral centroid (Hz)
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    centroid_hz = round(float(np.mean(centroid)), 2)

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
        spectral_centroid=centroid_hz,
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

@app.get("/health")
async def health():
    return {"status": "ok"}
