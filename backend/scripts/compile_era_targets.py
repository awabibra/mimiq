import os
import sys
import json
import argparse
from pathlib import Path
from typing import List, Dict

import numpy as np

# Let this script import the backend module when run directly.
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from main import load_audio_bytes, compute_metrics, AudioMetrics
except ImportError:
    print("Error: Could not import from main.py. Ensure you are running from the backend directory.")
    sys.exit(1)

def process_directory(input_dir: Path) -> List[AudioMetrics]:
    """Read the reference files in one genre folder."""
    audio_extensions = {'.wav', '.flac', '.mp3'}
    audio_files = [f for f in input_dir.iterdir() if f.is_file() and f.suffix.lower() in audio_extensions]

    if not audio_files:
        return []

    print(f"  Found {len(audio_files)} reference files in {input_dir.name}. Processing...")
    all_metrics = []

    for idx, file_path in enumerate(audio_files):
        print(f"    [{idx+1}/{len(audio_files)}] Analyzing {file_path.name}")
        try:
            audio_bytes = file_path.read_bytes()
            y_vocal, sr_vocal = load_audio_bytes(audio_bytes, duration=None)
            metrics = compute_metrics(y_vocal, sr_vocal)
            all_metrics.append(metrics)
        except Exception as e:
            print(f"    [Error] Failed to process {file_path.name}: {e}")

    return all_metrics

def aggregate_metrics(metrics_list: List[AudioMetrics]) -> Dict:
    """Average each metric and estimate consistency between tracks."""
    if not metrics_list:
        return None

    aggregated = {}
    fields = metrics_list[0].model_dump().keys()

    for field in fields:
        values = [getattr(m, field) for m in metrics_list if getattr(m, field) is not None]
        if not values:
            aggregated[field] = None
            continue

        if isinstance(values[0], list):
            try:
                arr_values = np.array(values, dtype=float)
                mean_arr = np.mean(arr_values, axis=0).tolist()
                aggregated[field] = [round(x, 3) for x in mean_arr]
            except Exception:
                aggregated[field] = values[0]
        else:
            mean_val = float(np.mean(values))
            aggregated[field] = round(mean_val, 3)

            std_val = float(np.std(values))
            # This is only a consistency score for the reference set.
            confidence = 1.0 / (1.0 + std_val * 0.25)
            aggregated[f"{field}_confidence"] = round(confidence, 2)

    return aggregated

def main():
    print("=== MimiQ Offline Era Processor ===")
    base_dir = Path(__file__).parent.parent / "data" / "references"
    output_file = Path(__file__).parent.parent / "data" / "references" / "era_targets.json"

    if not base_dir.exists():
        print(f"Error: {base_dir} does not exist. Run setup_era_directories.py first.")
        sys.exit(1)

    golden_profiles = {}

    subdirs = [d for d in base_dir.iterdir() if d.is_dir()]

    for subdir in subdirs:
        subgenre_id = subdir.name
        metrics_list = process_directory(subdir)

        if metrics_list:
            print(f"  Aggregating targets for {subgenre_id}...")
            aggregated = aggregate_metrics(metrics_list)
            if aggregated:
                golden_profiles[subgenre_id] = aggregated
                print(f"  ✓ {subgenre_id} compiled successfully.\n")
        else:
            print(f"  Skipping {subgenre_id} (No audio files found).\n")

    from datetime import datetime, timezone
    print(f"Writing {len(golden_profiles)} compiled profiles to {output_file.name}...")
    output_data = {
        "schema_version": "1.1",
        "compiled_at": datetime.now(timezone.utc).isoformat(),
        "profiles": golden_profiles
    }
    with open(output_file, "w") as f:
        json.dump(output_data, f, indent=2)

    print("Done! The engine is now updated with the latest targets.")

if __name__ == "__main__":
    main()
