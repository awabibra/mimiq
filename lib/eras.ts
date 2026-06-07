export interface Era {
  id: string;
  name: string;
  description: string;
  accent: string;
  subtleGradient: string;
}

export const eras: Era[] = [
  {
    id: "rnb",
    name: "RnB",
    description: "Dark R&B — lush pads, intimate vocals, late-night atmosphere",
    accent: "#C4547A",
    subtleGradient:
      "linear-gradient(135deg, rgba(196, 84, 122, 0.08) 0%, rgba(196, 84, 122, 0.02) 100%)",
  },
  {
    id: "trap",
    name: "Trap Music",
    description: "Modern trap — hard 808s, crisp hi-hats, aggressive delivery",
    accent: "#7B5FD4",
    subtleGradient:
      "linear-gradient(135deg, rgba(123, 95, 212, 0.08) 0%, rgba(123, 95, 212, 0.02) 100%)",
  },
  {
    id: "current",
    name: "Afrofusion",
    description: "Afrobeats — rhythmic percussion, log drums, melodic hooks",
    accent: "#4AAD6A",
    subtleGradient:
      "linear-gradient(135deg, rgba(74, 173, 106, 0.08) 0%, rgba(74, 173, 106, 0.02) 100%)",
  },
  {
    id: "golden",
    name: "Hip Hop",
    description: "Hip-hop — boom-bap roots, sampled soul, warm compression",
    accent: "#D4A84B",
    subtleGradient:
      "linear-gradient(135deg, rgba(212, 168, 75, 0.08) 0%, rgba(212, 168, 75, 0.02) 100%)",
  },
  {
    id: "crystalline",
    name: "Drill Rap",
    description: "UK drill — sliding 808s, sparse percussion, cold atmospheres",
    accent: "#4ABCBC",
    subtleGradient:
      "linear-gradient(135deg, rgba(74, 188, 188, 0.08) 0%, rgba(74, 188, 188, 0.02) 100%)",
  },
  {
    id: "foryou",
    name: "4you",
    description: "Custom era — fully dial in your signature sound",
    accent: "#E2E2E2",
    subtleGradient:
      "linear-gradient(135deg, rgba(226, 226, 226, 0.08) 0%, rgba(226, 226, 226, 0.02) 100%)",
  },
];

export const defaultEra = eras.find((e) => e.id === "golden")!;

export function getEraById(id: string): Era | undefined {
  return eras.find((e) => e.id === id);
}
