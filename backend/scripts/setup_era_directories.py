import os
from pathlib import Path

SUBGENRES = [
    "hard_trap", "dark_trap", "melodic_trap", "emo_trap", "pluggnb",
    "uk_melodic_drill", "brooklyn_ny_drill", "chicago_drill", "afro_drill", "pop_drill",
    "contemporary_rnb", "cinematic_rnb", "neo_soul", "afrobeats", "sad_rnb",
    "mainstream_pop", "dark_pop", "latin_trap", "hyperpop_digicore", "bedroom_pop"
]

def main():
    base_dir = Path(__file__).parent.parent / "data" / "references"
    base_dir.mkdir(parents=True, exist_ok=True)

    print(f"Creating 20 genre directories in {base_dir}...")

    for subgenre in SUBGENRES:
        target_dir = base_dir / subgenre
        target_dir.mkdir(exist_ok=True)

        (target_dir / ".gitkeep").touch()

        readme_path = target_dir / "README.md"
        if not readme_path.exists():
            with open(readme_path, "w") as f:
                f.write(f"# {subgenre} References\n\nDrop your isolated `.wav` or `.flac` vocal acapellas for this subgenre here.\nThe offline processor will average their DSP metrics to create the golden target.")

        print(f"  ✓ Created {subgenre}/")

    print("\nDone! You can now drag and drop your reference acapellas.")

if __name__ == "__main__":
    main()
