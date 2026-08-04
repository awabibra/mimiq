import type { ChainStep, XYPosition } from "./types";

/* Used when Claude still returns bad JSON after a retry. */

interface FallbackChain {
  chain: ChainStep[];
  summary: string;
  xyPosition: XYPosition;
}

const fallbacks: Record<string, FallbackChain> = {
  rnb: {
    chain: [
      { step: 1, tool: "High-Pass Filter", action: "Cut at 80 Hz, 18 dB/oct slope", reason: "Removes sub-bass rumble without thinning the vocal warmth essential for dark R&B." },
      { step: 2, tool: "Subtractive EQ", action: "Dip −3 dB at 350 Hz, Q 2.0", reason: "Reduces boxiness that competes with pad harmonics in the low-mids." },
      { step: 3, tool: "Optical Compressor", action: "3:1 ratio, 12 ms attack, auto release, −6 dB GR", reason: "Gentle leveling that preserves the breathy intimacy of the performance." },
      { step: 4, tool: "De-Esser", action: "Target 6 kHz, −4 dB reduction", reason: "Tames sibilance before it gets amplified by the reverb tail." },
      { step: 5, tool: "Plate Reverb", action: "2.2 s decay, 22% wet, pre-delay 40 ms", reason: "Creates the lush, late-night depth characteristic of this era." },
      { step: 6, tool: "Stereo Chorus", action: "0.3 Hz rate, 15% depth, 20% mix", reason: "Adds subtle width and movement to fill the stereo field." },
    ],
    summary: "Warm, intimate vocal treatment designed for nocturnal R&B — controlled low-end, smooth dynamics, and spacious reverb.",
    xyPosition: { x: 0.65, y: 0.35 },
  },

  trap: {
    chain: [
      { step: 1, tool: "High-Pass Filter", action: "Cut at 120 Hz, 24 dB/oct slope", reason: "Aggressive cut to prevent the vocal from clashing with heavy 808s." },
      { step: 2, tool: "Subtractive EQ", action: "Dip −4 dB at 500 Hz, Q 1.5", reason: "Clears muddiness so the vocal punches through distorted textures." },
      { step: 3, tool: "FET Compressor", action: "4:1 ratio, 1 ms attack, 50 ms release, −8 dB GR", reason: "Fast, aggressive compression that keeps the vocal upfront and in-your-face." },
      { step: 4, tool: "Saturation", action: "Tape mode, 25% drive, mix 40%", reason: "Adds harmonic grit that matches the aggressive production style." },
      { step: 5, tool: "De-Esser", action: "Target 7 kHz, −5 dB reduction", reason: "Controls harshness amplified by the saturation stage." },
      { step: 6, tool: "Short Room Reverb", action: "0.6 s decay, 12% wet, pre-delay 10 ms", reason: "Tight ambience that adds presence without pushing the vocal back." },
    ],
    summary: "Hard-hitting vocal chain for trap — aggressive dynamics, harmonic distortion, and tight spatial placement.",
    xyPosition: { x: 0.25, y: 0.7 },
  },

  pop: {
    chain: [
      { step: 1, tool: "High-Pass Filter", action: "Cut at 100 Hz, 18 dB/oct slope", reason: "Cleans the low end to let the vocal sit precisely in a dense pop mix." },
      { step: 2, tool: "Presence EQ", action: "Boost +3 dB at 3.5 kHz, Q 1.2", reason: "Pushes the vocal forward to compete with bright synths and instrumentation." },
      { step: 3, tool: "Optical Compressor", action: "3:1 ratio, 15 ms attack, auto release, −5 dB GR", reason: "Smooth leveling that maintains the melodic flow of the performance." },
      { step: 4, tool: "De-Esser", action: "Target 6.5 kHz, −3 dB reduction", reason: "Light sibilance control to keep clarity without dulling." },
      { step: 5, tool: "Short Delay", action: "1/8 note, 15% feedback, 18% mix", reason: "Rhythmic delay that locks the vocal into the groove." },
      { step: 6, tool: "Hall Reverb", action: "1.4 s decay, 16% wet, pre-delay 25 ms", reason: "Adds depth and pristine space without washing out the rhythm." },
    ],
    summary: "Bright, punchy vocal treatment for modern pop — clarity-focused EQ, controlled dynamics, and pristine space.",
    xyPosition: { x: 0.45, y: 0.6 },
  },

  modern_rap: {
    chain: [
      { step: 1, tool: "Gate", action: "Threshold -45 dB, 5 ms attack", reason: "Cleans up background noise before processing begins." },
      { step: 2, tool: "High-Pass Filter", action: "Cut at 90 Hz, 12 dB/oct slope", reason: "Gentle roll-off preserves the warmth of boom-bap productions." },
      { step: 3, tool: "Subtractive EQ", action: "Dip −2 dB at 400 Hz, Q 2.5", reason: "Reduces boxiness while keeping the thick, analog character." },
      { step: 4, tool: "1176 FET Compressor", action: "4:1 ratio, fast attack, fast release, −7 dB GR", reason: "Aggressive compression to catch initial peaks." },
      { step: 5, tool: "LA-2A Optical Compressor", action: "Peak Reduction 40, Gain 35", reason: "Smooth leveling after the fast FET compressor." },
      { step: 6, tool: "Additive EQ", action: "Boost +1.5 dB at 3 kHz, Q 1.0", reason: "Pushes the vocal forward in the mix." },
      { step: 7, tool: "Air EQ", action: "Shelf boost +2 dB above 10 kHz", reason: "Adds clarity and presence without harshness — classic 90s vocal sparkle." },
      { step: 8, tool: "Multiband Compressor", action: "Control 200-500 Hz region", reason: "Dynamically tames low-mid buildup when the rapper gets closer to the mic." },
      { step: 9, tool: "De-Esser", action: "Target 6 kHz, −3 dB reduction", reason: "Mild sibilance control to keep the top end smooth." },
      { step: 10, tool: "Tape Saturation", action: "15 IPS, +2 dB drive", reason: "Glues the vocal with analog warmth and soft clipping." },
    ],
    summary: "A massive, punchy vocal chain for classic hip-hop — dual-stage compression, meticulous EQ sculpting, dynamic control, and rich analog warmth.",
    xyPosition: { x: 0.3, y: 0.5 },
  },
};

/** Returns the fallback chain for a given era ID, or modern_rap as default. */
export function getFallbackChain(eraId: string): FallbackChain {
  return fallbacks[eraId] ?? fallbacks.modern_rap;
}
