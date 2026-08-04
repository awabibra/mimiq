import io
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from main import (
    app,
    build_demucs_command,
    compute_bs1770_loudness,
    compute_true_peak,
    detect_recording_evidence,
    detect_temporal_collisions,
)


def sine(frequency: float, seconds: float, sample_rate: int, amplitude: float) -> np.ndarray:
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    return amplitude * np.sin(2 * np.pi * frequency * time)


class AudioMeasurementTests(unittest.TestCase):
    def test_stereo_analyze_response_contains_only_finite_numbers(self):
        sample_rate = 48000
        left = sine(997, 2.0, sample_rate, 0.24)
        right = sine(1203, 2.0, sample_rate, 0.18)
        buffer = io.BytesIO()
        sf.write(buffer, np.column_stack([left, right]), sample_rate, format="WAV")

        response = TestClient(app).post(
            "/analyze",
            files={"vocal": ("stereo.wav", buffer.getvalue(), "audio/wav")},
        )
        self.assertEqual(response.status_code, 200, response.text)

        def assert_finite(value):
            if isinstance(value, dict):
                for child in value.values():
                    assert_finite(child)
            elif isinstance(value, list):
                for child in value:
                    assert_finite(child)
            elif isinstance(value, float):
                self.assertTrue(np.isfinite(value))

        assert_finite(response.json())

    def test_bs1770_loudness_is_repeatable_for_fixed_tone(self):
        sample_rate = 48000
        audio = sine(1000, 3.0, sample_rate, 0.1)
        measured = compute_bs1770_loudness(audio, sample_rate)
        self.assertGreaterEqual(measured, -23.5)
        self.assertLessEqual(measured, -22.5)

    def test_true_peak_oversampling_never_under_reports_sample_peak(self):
        sample_rate = 48000
        audio = sine(997, 1.0, sample_rate, 0.9)
        sample_peak = 20 * np.log10(np.max(np.abs(audio)))
        self.assertGreaterEqual(compute_true_peak(audio), round(float(sample_peak), 1))

    def test_temporal_collision_includes_time_band_and_measured_energies(self):
        sample_rate = 16000
        vocal = np.zeros(sample_rate * 2)
        beat = np.zeros(sample_rate * 2)
        vocal[sample_rate // 2:sample_rate + sample_rate // 2] = sine(2200, 1.0, sample_rate, 0.18)
        beat[sample_rate // 2:sample_rate + sample_rate // 2] = sine(2200, 1.0, sample_rate, 0.3)

        findings = detect_temporal_collisions(vocal, sample_rate, beat, sample_rate)
        target = next(
            finding for finding in findings
            if finding.frequency_low_hz <= 2200 <= finding.frequency_high_hz
        )
        self.assertGreaterEqual(target.start_seconds, 0.35)
        self.assertLessEqual(target.start_seconds, 0.65)
        self.assertGreaterEqual(target.end_seconds, 1.35)
        self.assertLessEqual(target.end_seconds, 1.65)
        self.assertGreater(target.beat_energy_db, target.vocal_energy_db)
        self.assertEqual(target.analysis_version, "temporal_masking_v2")

    def test_recording_events_are_relative_to_the_same_take(self):
        sample_rate = 16000
        audio = sine(300, 2.0, sample_rate, 0.08)
        audio[sample_rate:sample_rate + sample_rate // 2] += sine(
            3500,
            0.5,
            sample_rate,
            0.4,
        )
        events = detect_recording_evidence(audio, sample_rate)
        presence = next(event for event in events if event.kind == "presence_spike")
        self.assertGreaterEqual(presence.delta_db, 6.0)
        self.assertEqual(presence.analysis_version, "recording_events_v2")

    def test_two_stem_command_requests_complete_instrumental(self):
        command = build_demucs_command(
            Path("source.wav"),
            Path("output"),
            2,
            "htdemucs",
        )
        self.assertIn("--two-stems", command)
        self.assertEqual(command[command.index("--two-stems") + 1], "vocals")


if __name__ == "__main__":
    unittest.main()
