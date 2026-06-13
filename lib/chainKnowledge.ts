export type CompressionStyle =
  | "FET_1176"
  | "OPTICAL_LA2A"
  | "VCA_SSL"
  | "TUBE_CL1B";

export type GenreProfile = {
  philosophy: string;
  compression: {
    primary: {
      style: CompressionStyle;
      ratio: string;
      attack_ms: number;
      release_ms: number;
      threshold_db: number;
      gain_reduction_db: number;
    };
    secondary?: {
      style: "OPTICAL_LA2A" | "VCA_SSL";
      settings: string;
    };
  };
  eq: {
    highpass_hz: number;
    subtractive: { frequency: number; gain_db: number; q: number }[];
    additive: {
      frequency: number;
      gain_db: number;
      q: number;
      type: "bell" | "shelf";
    }[];
  };
  deesser: {
    frequency: number;
    reduction_db: number;
    mode: "gentle" | "moderate" | "aggressive";
  };
  gate: { threshold_db: number; attack_ms: number; release_ms: number };
  saturation: {
    drive: number;
    character: "tape" | "tube" | "transistor" | "none";
    mix_percent: number;
  };
  buses: {
    reverb: {
      decay_s: number;
      pre_delay_ms: number;
      mix_percent: number;
      sidechained: boolean;
      character: string;
    };
    delay: {
      time: string;
      feedback_percent: number;
      mix_percent: number;
      automated: boolean;
    };
    parallel_comp?: {
      ratio: string;
      attack_ms: number;
      blend_percent: number;
    };
    width?: {
      amount_percent: number;
      style: "chorus" | "microshift" | "haas" | "none";
    };
    saturation_bus?: { style: string; mix_percent: number };
    distortion_bus?: { style: string; blend_percent: number };
    mastering: {
      bus_comp: {
        ratio: string;
        attack_ms: number;
        release_ms: number;
        gain_reduction_db: number;
      };
      limiter_ceiling_db: number;
    };
  };
  lufs_target: number;
  dynamic_range_target: number;
};

export type GenreName =
  | "trap music"
  | "rnb"
  | "drill rap"
  | "hip hop"
  | "afrofusion"
  | "4you";

export const DAW_PLUGINS = {
  "Logic Pro": {
    gate: "Noise Gate",
    highpass: "Channel EQ",
    lowpass: "Channel EQ",
    notch_filter: "Channel EQ",
    subtractive_eq: "Channel EQ",
    additive_eq: "Channel EQ",
    air_eq: "Channel EQ",
    tilt_eq: "Channel EQ",
    compressor_primary: "Vintage VCA",
    compressor_secondary: "Vintage Opto",
    compressor_vca: "Vintage VCA",
    compressor_optical: "Vintage Opto",
    compressor_vari_mu: "Compressor",
    limiter: "Adaptive Limiter",
    transient_shaper: "Enveloper",
    deesser: "DeEsser 2",
    pitch_correction: "Pitch Correction",
    noise_reduction: "Noise Gate",
    saturation: "Tape Delay",
    tape_saturation: "Tape Delay",
    tube_saturation: "Overdrive",
    exciter: "Exciter",
    short_reverb: "ChromaVerb",
    long_reverb: "ChromaVerb",
    slap_delay: "Stereo Delay",
    rhythmic_delay: "Stereo Delay",
    chorus: "Chorus",
    reverb_bus_reverb: "ChromaVerb",
    reverb_bus_comp: "Compressor",
    delay_bus: "Stereo Delay",
    parallel_comp_bus: "Vintage VCA",
    width_bus: "Chorus",
    saturation_bus: "Bitcrusher",
    distortion_bus: "Overdrive",
    mastering_bus_comp: "Vintage VCA",
    mastering_limiter: "Adaptive Limiter",
  },
  "FL Studio": {
    gate: "Fruity Peak Controller",
    highpass: "Parametric EQ 2",
    lowpass: "Parametric EQ 2",
    notch_filter: "Parametric EQ 2",
    subtractive_eq: "Parametric EQ 2",
    additive_eq: "Parametric EQ 2",
    air_eq: "Parametric EQ 2",
    tilt_eq: "Parametric EQ 2",
    compressor_primary: "Fruity Peak Controller",
    compressor_secondary: "Maximus",
    compressor_vca: "Fruity Compressor",
    compressor_optical: "Maximus",
    compressor_vari_mu: "Maximus",
    limiter: "Fruity Limiter",
    transient_shaper: "Transient Processor",
    deesser: "Parametric EQ 2",
    pitch_correction: "NewTone",
    noise_reduction: "Fruity Limiter",
    saturation: "Fruity WaveShaper",
    tape_saturation: "Fruity WaveShaper",
    tube_saturation: "Fruity Blood Overdrive",
    exciter: "Soundgoodizer",
    short_reverb: "Fruity Reeverb 2",
    long_reverb: "Fruity Reeverb 2",
    slap_delay: "Fruity Delay 3",
    rhythmic_delay: "Fruity Delay 3",
    chorus: "Fruity Chorus",
    reverb_bus_reverb: "Fruity Reeverb 2",
    reverb_bus_comp: "Fruity Peak Controller",
    delay_bus: "Fruity Delay 3",
    parallel_comp_bus: "Maximus",
    width_bus: "Fruity Stereo Enhancer",
    saturation_bus: "Fruity WaveShaper",
    distortion_bus: "Fruity Blood Overdrive",
    mastering_bus_comp: "Maximus",
    mastering_limiter: "Fruity Limiter",
  },
  "Ableton Live": {
    gate: "Gate",
    highpass: "EQ Eight",
    lowpass: "EQ Eight",
    notch_filter: "EQ Eight",
    subtractive_eq: "EQ Eight",
    additive_eq: "EQ Eight",
    air_eq: "EQ Eight",
    tilt_eq: "EQ Eight",
    compressor_primary: "Compressor",
    compressor_secondary: "Glue Compressor",
    compressor_vca: "Compressor",
    compressor_optical: "Glue Compressor",
    compressor_vari_mu: "Compressor",
    limiter: "Limiter",
    transient_shaper: "Drum Buss",
    deesser: "Multiband Dynamics",
    pitch_correction: "Tuner",
    noise_reduction: "Gate",
    saturation: "Saturator",
    tape_saturation: "Saturator",
    tube_saturation: "Roar",
    exciter: "Saturator",
    short_reverb: "Reverb",
    long_reverb: "Hybrid Reverb",
    slap_delay: "Simple Delay",
    rhythmic_delay: "Echo",
    chorus: "Chorus-Ensemble",
    reverb_bus_reverb: "Reverb",
    reverb_bus_comp: "Compressor",
    delay_bus: "Simple Delay",
    parallel_comp_bus: "Compressor",
    width_bus: "Chorus-Ensemble",
    saturation_bus: "Saturator",
    distortion_bus: "Roar",
    mastering_bus_comp: "Glue Compressor",
    mastering_limiter: "Limiter",
  },
  "Pro Tools": {
    gate: "ReaGate",
    highpass: "EQ3 7-Band",
    lowpass: "EQ3 7-Band",
    notch_filter: "EQ3 7-Band",
    subtractive_eq: "EQ3 7-Band",
    additive_eq: "EQ3 7-Band",
    air_eq: "EQ3 7-Band",
    tilt_eq: "EQ3 7-Band",
    compressor_primary: "BF-76",
    compressor_secondary: "LA-2A",
    compressor_vca: "Dyn3 Compressor/Limiter",
    compressor_optical: "LA-2A",
    compressor_vari_mu: "BF-2A",
    limiter: "L1 Ultramaximizer",
    transient_shaper: "Smack!",
    deesser: "DeEsser",
    pitch_correction: "Elastic Pitch",
    noise_reduction: "Dyn3 Expander/Gate",
    saturation: "AIR Distortion",
    tape_saturation: "AIR Distortion",
    tube_saturation: "AIR Distortion",
    exciter: "AIR Enhancer",
    short_reverb: "AIR Reverb",
    long_reverb: "D-Verb",
    slap_delay: "AIR Dynamic Delay",
    rhythmic_delay: "AIR Dynamic Delay",
    chorus: "AIR Chorus",
    reverb_bus_reverb: "AIR Reverb",
    reverb_bus_comp: "76",
    delay_bus: "AIR Dynamic Delay",
    parallel_comp_bus: "BF-76",
    width_bus: "AIR Stereo Width",
    saturation_bus: "AIR Distortion",
    distortion_bus: "AIR Distortion",
    mastering_bus_comp: "BF-2A",
    mastering_limiter: "L1 Ultramaximizer",
  },
} satisfies Record<string, Record<string, string>>;

export type DawName = keyof typeof DAW_PLUGINS;

export const GENRE_PROFILES: Record<GenreName, GenreProfile> = {
  "trap music": {
    philosophy:
      "Dark, clean, atmospheric rap vocals that sit in the pocket of hard 808s through fast FET control, sculpted low-mids, short ducked ambience, phrase-ending delay, and dense parallel compression.",
    compression: {
      primary: {
        style: "FET_1176",
        ratio: "4:1",
        attack_ms: 2,
        release_ms: 50,
        threshold_db: -24,
        gain_reduction_db: 7,
      },
    },
    eq: {
      highpass_hz: 100,
      subtractive: [
        { frequency: 350, gain_db: -5, q: 1.5 },
        { frequency: 700, gain_db: -2, q: 1.2 },
      ],
      additive: [
        { frequency: 2750, gain_db: 3, q: 1.1, type: "bell" },
        { frequency: 10000, gain_db: 3, q: 0.7, type: "shelf" },
      ],
    },
    deesser: { frequency: 7000, reduction_db: 5, mode: "aggressive" },
    gate: { threshold_db: -42, attack_ms: 2, release_ms: 90 },
    saturation: { drive: 0, character: "none", mix_percent: 0 },
    buses: {
      reverb: {
        decay_s: 0.6,
        pre_delay_ms: 15,
        mix_percent: 12,
        sidechained: true,
        character: "short dark room",
      },
      delay: {
        time: "1/8",
        feedback_percent: 18,
        mix_percent: 10,
        automated: true,
      },
      parallel_comp: { ratio: "all-buttons", attack_ms: 1, blend_percent: 20 },
      width: { amount_percent: 18, style: "chorus" },
      mastering: {
        bus_comp: {
          ratio: "2:1",
          attack_ms: 30,
          release_ms: 50,
          gain_reduction_db: 2,
        },
        limiter_ceiling_db: -0.3,
      },
    },
    lufs_target: -10,
    dynamic_range_target: 4,
  },
  rnb: {
    philosophy:
      "Intimate OVO-style vocal placement where the low end is carved away, the vocal owns the mid-high and top end, dynamics stay smooth, and long ducked ambience stays behind an upfront lead.",
    compression: {
      primary: {
        style: "OPTICAL_LA2A",
        ratio: "3:1",
        attack_ms: 10,
        release_ms: 600,
        threshold_db: -20,
        gain_reduction_db: 3,
      },
    },
    eq: {
      highpass_hz: 120,
      subtractive: [{ frequency: 400, gain_db: -2, q: 1.2 }],
      additive: [
        { frequency: 3000, gain_db: 1.5, q: 1, type: "bell" },
        { frequency: 12000, gain_db: 4, q: 0.7, type: "shelf" },
      ],
    },
    deesser: { frequency: 7500, reduction_db: 2.5, mode: "gentle" },
    gate: { threshold_db: -55, attack_ms: 8, release_ms: 180 },
    saturation: { drive: 5, character: "tape", mix_percent: 7 },
    buses: {
      reverb: {
        decay_s: 1.6,
        pre_delay_ms: 40,
        mix_percent: 22,
        sidechained: true,
        character: "long lush room",
      },
      delay: {
        time: "1/4",
        feedback_percent: 18,
        mix_percent: 14,
        automated: true,
      },
      width: { amount_percent: 30, style: "microshift" },
      saturation_bus: { style: "subtle tape warmth", mix_percent: 8 },
      mastering: {
        bus_comp: {
          ratio: "1:1",
          attack_ms: 30,
          release_ms: 100,
          gain_reduction_db: 0.5,
        },
        limiter_ceiling_db: -0.3,
      },
    },
    lufs_target: -14,
    dynamic_range_target: 6,
  },
  "drill rap": {
    philosophy:
      "Dry, close, cold drill vocals with aggressive cleanup, midrange focus, tight punch-preserving compression, almost no ambience, and controlled grit for edge.",
    compression: {
      primary: {
        style: "FET_1176",
        ratio: "6:1",
        attack_ms: 10,
        release_ms: 60,
        threshold_db: -26,
        gain_reduction_db: 8,
      },
    },
    eq: {
      highpass_hz: 100,
      subtractive: [
        { frequency: 300, gain_db: -5, q: 1.4 },
        { frequency: 500, gain_db: -3, q: 1.5 },
        { frequency: 700, gain_db: -2.5, q: 1.2 },
      ],
      additive: [
        { frequency: 3500, gain_db: 3, q: 1, type: "bell" },
        { frequency: 8500, gain_db: 0.5, q: 0.8, type: "shelf" },
      ],
    },
    deesser: { frequency: 6000, reduction_db: 4, mode: "moderate" },
    gate: { threshold_db: -38, attack_ms: 1, release_ms: 60 },
    saturation: { drive: 8, character: "transistor", mix_percent: 8 },
    buses: {
      reverb: {
        decay_s: 0.3,
        pre_delay_ms: 5,
        mix_percent: 6,
        sidechained: false,
        character: "very short room glue",
      },
      delay: {
        time: "1/16",
        feedback_percent: 8,
        mix_percent: 5,
        automated: false,
      },
      parallel_comp: { ratio: "8:1", attack_ms: 8, blend_percent: 25 },
      distortion_bus: { style: "subtle overdrive edge", blend_percent: 12 },
      mastering: {
        bus_comp: {
          ratio: "4:1",
          attack_ms: 10,
          release_ms: 50,
          gain_reduction_db: 3,
        },
        limiter_ceiling_db: -0.3,
      },
    },
    lufs_target: -11,
    dynamic_range_target: 4,
  },
  "hip hop": {
    philosophy:
      "Warm, punchy, upfront boom-bap vocal treatment built around serial 1176 into LA-2A leveling, classic low-mid cleanup, moderate room, rhythmic delay, and SSL-style glue.",
    compression: {
      primary: {
        style: "FET_1176",
        ratio: "4:1",
        attack_ms: 2,
        release_ms: 60,
        threshold_db: -24,
        gain_reduction_db: 6,
      },
      secondary: {
        style: "OPTICAL_LA2A",
        settings: "Peak reduction 35, gain 35 for smooth leveling after the FET compressor",
      },
    },
    eq: {
      highpass_hz: 100,
      subtractive: [
        { frequency: 300, gain_db: -3, q: 1.4 },
        { frequency: 700, gain_db: -2, q: 1.2 },
      ],
      additive: [
        { frequency: 1500, gain_db: 2, q: 1, type: "bell" },
        { frequency: 10000, gain_db: 2, q: 0.7, type: "shelf" },
      ],
    },
    deesser: { frequency: 6500, reduction_db: 3.5, mode: "moderate" },
    gate: { threshold_db: -45, attack_ms: 3, release_ms: 110 },
    saturation: { drive: 12, character: "tape", mix_percent: 10 },
    buses: {
      reverb: {
        decay_s: 0.8,
        pre_delay_ms: 20,
        mix_percent: 15,
        sidechained: false,
        character: "medium warm room",
      },
      delay: {
        time: "1/8",
        feedback_percent: 25,
        mix_percent: 12,
        automated: true,
      },
      parallel_comp: { ratio: "4:1", attack_ms: 2, blend_percent: 18 },
      width: { amount_percent: 12, style: "haas" },
      mastering: {
        bus_comp: {
          ratio: "2:1",
          attack_ms: 30,
          release_ms: 100,
          gain_reduction_db: 2,
        },
        limiter_ceiling_db: -0.3,
      },
    },
    lufs_target: -12,
    dynamic_range_target: 5,
  },
  afrofusion: {
    philosophy:
      "Warm melodic lead vocal that rides on top of rhythmic percussion with preserved movement, gentle compression, air and warmth together, lush timed space, and chorus-like width.",
    compression: {
      primary: {
        style: "TUBE_CL1B",
        ratio: "3:1",
        attack_ms: 15,
        release_ms: 150,
        threshold_db: -20,
        gain_reduction_db: 3.5,
      },
    },
    eq: {
      highpass_hz: 90,
      subtractive: [{ frequency: 400, gain_db: -2, q: 1.2 }],
      additive: [
        { frequency: 900, gain_db: 1.5, q: 1.1, type: "bell" },
        { frequency: 2500, gain_db: 2, q: 1, type: "bell" },
        { frequency: 12000, gain_db: 3, q: 0.7, type: "shelf" },
      ],
    },
    deesser: { frequency: 7000, reduction_db: 2.5, mode: "gentle" },
    gate: { threshold_db: -50, attack_ms: 5, release_ms: 150 },
    saturation: { drive: 8, character: "tape", mix_percent: 7 },
    buses: {
      reverb: {
        decay_s: 1.25,
        pre_delay_ms: 40,
        mix_percent: 20,
        sidechained: true,
        character: "lush medium room",
      },
      delay: {
        time: "1/4 dotted",
        feedback_percent: 20,
        mix_percent: 20,
        automated: true,
      },
      width: { amount_percent: 35, style: "chorus" },
      mastering: {
        bus_comp: {
          ratio: "2:1",
          attack_ms: 30,
          release_ms: 100,
          gain_reduction_db: 1.5,
        },
        limiter_ceiling_db: -0.5,
      },
    },
    lufs_target: -12,
    dynamic_range_target: 5,
  },
  "4you": {
    philosophy:
      "Custom mimiq blend of R&B top-end intimacy and hip-hop punch, with values kept responsive to the user's actual loudness, range, brightness, and sibilance measurements.",
    compression: {
      primary: {
        style: "FET_1176",
        ratio: "3:1",
        attack_ms: 8,
        release_ms: 180,
        threshold_db: -21,
        gain_reduction_db: 4,
      },
      secondary: {
        style: "OPTICAL_LA2A",
        settings: "Light optical leveling, peak reduction 25, gain 30",
      },
    },
    eq: {
      highpass_hz: 110,
      subtractive: [
        { frequency: 350, gain_db: -2.5, q: 1.3 },
        { frequency: 700, gain_db: -1.5, q: 1.1 },
      ],
      additive: [
        { frequency: 3000, gain_db: 2, q: 1, type: "bell" },
        { frequency: 12000, gain_db: 3.5, q: 0.7, type: "shelf" },
      ],
    },
    deesser: { frequency: 7500, reduction_db: 3, mode: "moderate" },
    gate: { threshold_db: -48, attack_ms: 4, release_ms: 130 },
    saturation: { drive: 7, character: "tape", mix_percent: 7 },
    buses: {
      reverb: {
        decay_s: 1.2,
        pre_delay_ms: 35,
        mix_percent: 18,
        sidechained: true,
        character: "intimate room with controlled tail",
      },
      delay: {
        time: "1/4",
        feedback_percent: 20,
        mix_percent: 14,
        automated: true,
      },
      parallel_comp: { ratio: "4:1", attack_ms: 4, blend_percent: 12 },
      width: { amount_percent: 24, style: "microshift" },
      saturation_bus: { style: "subtle tape polish", mix_percent: 6 },
      mastering: {
        bus_comp: {
          ratio: "1.5:1",
          attack_ms: 30,
          release_ms: 100,
          gain_reduction_db: 1,
        },
        limiter_ceiling_db: -0.3,
      },
    },
    lufs_target: -13,
    dynamic_range_target: 6,
  },
};

export function getGenreName(eraId: string): GenreName {
  const map: Record<string, GenreName> = {
    trap: "trap music",
    volatile: "trap music",
    golden: "hip hop",
    rnb: "rnb",
    nocturnal: "rnb",
    current: "afrofusion",
    crystalline: "drill rap",
    foryou: "4you",
    "4you": "4you",
  };

  return map[eraId] ?? "hip hop";
}

export function getGenreProfile(eraId: string) {
  return GENRE_PROFILES[getGenreName(eraId)];
}
