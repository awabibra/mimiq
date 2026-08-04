import argparse
import os
import sys
import subprocess
import tempfile
import json
from pathlib import Path
from typing import List, Dict

import numpy as np
from dotenv import load_dotenv
from supabase import create_client, Client

# Let this script import the backend module when run directly.
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from main import load_audio_bytes, compute_metrics, AudioMetrics
except ImportError:
    print("Error: Could not import from main.py. Ensure you are running from the backend directory.")
    sys.exit(1)

def run_demucs_isolation(input_path: Path, output_dir: Path) -> Path:
    """Run Demucs and return the vocal stem path."""
    print(f"  [Demucs] Separating stems for {input_path.name}...")

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
        text=True,
        check=False
    )

    if result.returncode != 0:
        print(f"  [Error] Demucs failed for {input_path.name}: {result.stderr}")
        return None

    track_dir_name = input_path.stem
    vocal_stem_path = output_dir / "htdemucs" / track_dir_name / "vocals.wav"

    if not vocal_stem_path.exists():
        print(f"  [Error] Could not find vocals.wav at {vocal_stem_path}")
        return None

    return vocal_stem_path

def process_directory(input_dir: Path) -> List[AudioMetrics]:
    """Separate and measure every audio file in a folder."""
    audio_extensions = {'.wav', '.flac'}
    audio_files = [f for f in input_dir.iterdir() if f.is_file() and f.suffix.lower() in audio_extensions]

    if not audio_files:
        print(f"No .wav or .flac files found in {input_dir}")
        return []

    print(f"Found {len(audio_files)} lossless audio files. Processing...")
    all_metrics = []

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)

        for idx, file_path in enumerate(audio_files):
            print(f"[{idx+1}/{len(audio_files)}] Processing {file_path.name}")

            vocal_stem = run_demucs_isolation(file_path, temp_dir_path)
            if not vocal_stem:
                continue

            print(f"  [DSP] Extracting acoustic metrics...")
            try:
                audio_bytes = vocal_stem.read_bytes()
                # Reference profiles use the whole track.
                y_vocal, sr_vocal = load_audio_bytes(audio_bytes, duration=None)
                metrics = compute_metrics(y_vocal, sr_vocal)
                all_metrics.append(metrics)
                print(f"  [Success] LUFS: {metrics.lufs}, Centroid: {metrics.spectral_centroid}kHz")
            except Exception as e:
                print(f"  [Error] Failed to process metrics for {file_path.name}: {e}")

    return all_metrics

def aggregate_metrics(metrics_list: List[AudioMetrics]) -> Dict:
    """Get the mean and spread for each metric."""
    if not metrics_list:
        return {}

    aggregated = {}

    fields = metrics_list[0].model_dump().keys()

    for field in fields:
        values = [getattr(m, field) for m in metrics_list]

        mean_val = float(np.mean(values))
        std_val = float(np.std(values))

        aggregated[field] = {
            "mean": round(mean_val, 3),
            "std": round(std_val, 3)
        }

    return aggregated

def push_to_supabase(era_name: str, engineers: List[str], track_count: int, metrics: Dict):
    """Save the finished profile to Supabase."""
    load_dotenv(Path(__file__).parent.parent.parent / '.env.local')

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local")
        print("Cannot push to Supabase.")
        return

    supabase: Client = create_client(url, key)

    payload = {
        "name": era_name,
        "engineers": engineers,
        "track_count": track_count,
        "metrics": metrics
    }

    print(f"Pushing Golden Profile for '{era_name}' to Supabase...")
    try:
        supabase.table("era_profiles").upsert(
            payload,
            on_conflict="name"
        ).execute()

        print("Successfully saved to database!")
    except Exception as e:
        print(f"Failed to push to Supabase: {e}")

def main():
    parser = argparse.ArgumentParser(description="MimiQ Era Engine - Golden Profile Generator")
    parser.add_argument("--input_dir", type=str, required=True, help="Directory containing lossless audio files (.wav, .flac)")
    parser.add_argument("--era_name", type=str, required=True, help="Name of the Era (e.g. 'Modern Rap')")
    parser.add_argument("--engineers", type=str, nargs='*', default=[], help="List of engineers (e.g. 'Mixed By Ali' 'Jaycen Joshua')")

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.exists() or not input_dir.is_dir():
        print(f"Error: Directory {args.input_dir} does not exist.")
        sys.exit(1)

    print(f"=== Starting Golden Profile Generation for: {args.era_name} ===")

    metrics_list = process_directory(input_dir)

    if not metrics_list:
        print("No metrics extracted. Exiting.")
        sys.exit(1)

    print(f"\nAggregating metrics across {len(metrics_list)} tracks...")
    aggregated_metrics = aggregate_metrics(metrics_list)

    print("\nFinal Golden Profile:")
    print(json.dumps(aggregated_metrics, indent=2))

    push_to_supabase(
        era_name=args.era_name,
        engineers=args.engineers,
        track_count=len(metrics_list),
        metrics=aggregated_metrics
    )

if __name__ == "__main__":
    main()
