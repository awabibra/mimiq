import os
import glob
import json
import librosa
import numpy as np
import pyloudnorm as pyln

def extract_metrics(file_path: str):
    print(f"Processing {file_path}...")
    try:
        y, sr = librosa.load(file_path, sr=44100, mono=True)

        meter = pyln.Meter(sr)
        lufs = float(meter.integrated_loudness(y))

        lra = float(librosa.feature.rms(y=y).max() - librosa.feature.rms(y=y).mean())

        mel_spec = librosa.feature.melspectrogram(
            y=y, sr=sr, n_fft=2048, hop_length=512, n_mels=30, fmin=100, fmax=16000
        )
        mel_db = librosa.power_to_db(mel_spec, ref=np.max)
        spectral_envelope = np.mean(mel_db, axis=1).tolist()

        return {
            "lufs": lufs,
            "dynamic_range": lra,
            "spectral_envelope": spectral_envelope
        }
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return None

def train_profiles(base_dir: str):
    genres = ["modern_rap", "trap", "rnb", "pop"]
    profiles = {}

    for genre in genres:
        genre_dir = os.path.join(base_dir, genre)
        if not os.path.isdir(genre_dir):
            print(f"Skipping {genre}, directory not found.")
            continue

        files = glob.glob(os.path.join(genre_dir, "*.wav")) + glob.glob(os.path.join(genre_dir, "*.mp3"))
        if not files:
            print(f"No files found for {genre}.")
            continue

        print(f"Training {genre} profile from {len(files)} files...")

        genre_metrics = []
        for file in files:
            metrics = extract_metrics(file)
            if metrics:
                genre_metrics.append(metrics)

        if not genre_metrics:
            continue

        avg_lufs = np.mean([m["lufs"] for m in genre_metrics])
        avg_dr = np.mean([m["dynamic_range"] for m in genre_metrics])
        avg_spectral = np.mean([m["spectral_envelope"] for m in genre_metrics], axis=0).tolist()

        profiles[genre] = {
            "lufs_target": round(float(avg_lufs), 1),
            "dynamic_range_target": round(float(avg_dr), 1),
            "spectral_envelope": [round(float(x), 2) for x in avg_spectral]
        }

    output_path = os.path.join(os.path.dirname(__file__), "genreProfiles.json")
    with open(output_path, "w") as f:
        json.dump(profiles, f, indent=2)

    print(f"Successfully generated profiles and saved to {output_path}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Train genre profiles from reference tracks.")
    parser.add_argument("--data-dir", type=str, default="./reference_tracks", help="Directory containing genre folders.")
    args = parser.parse_args()

    train_profiles(args.data_dir)
