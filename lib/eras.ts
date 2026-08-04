export interface Era {
  id: string;
  name: string;
  description: string;
  accent: string;
  subtleGradient: string;
  image: string;
}

export const eras: Era[] = [
  {
    id: "modern_rap",
    name: "Modern Rap",
    description: "Modern Rap — aggressive delivery, saturated 808s, forward vocals",
    accent: "#D4A84B",
    subtleGradient:
      "linear-gradient(135deg, rgba(212, 168, 75, 0.08) 0%, rgba(212, 168, 75, 0.02) 100%)",
    image: "https://images.unsplash.com/photo-1571330735066-03aaa9429d89?q=80&w=2940&auto=format&fit=crop",
  },
  {
    id: "pop",
    name: "Pop",
    description: "Pop — bright, wide, heavily controlled dynamics, pristine highs",
    accent: "#4ABCBC",
    subtleGradient:
      "linear-gradient(135deg, rgba(74, 188, 188, 0.08) 0%, rgba(74, 188, 188, 0.02) 100%)",
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=2874&auto=format&fit=crop",
  },
  {
    id: "trap",
    name: "Trap",
    description: "Trap — hard 808s, fast triplets, aggressive dynamics, dark ambience",
    accent: "#7B5FD4",
    subtleGradient:
      "linear-gradient(135deg, rgba(123, 95, 212, 0.08) 0%, rgba(123, 95, 212, 0.02) 100%)",
    image: "https://images.unsplash.com/photo-1493225457124-a1a2a5f08538?q=80&w=2940&auto=format&fit=crop",
  },
  {
    id: "rnb",
    name: "R&B",
    description: "R&B — lush verbs, nocturnal atmosphere, dynamic low end",
    accent: "#C4547A",
    subtleGradient:
      "linear-gradient(135deg, rgba(196, 84, 122, 0.08) 0%, rgba(196, 84, 122, 0.02) 100%)",
    image: "https://images.unsplash.com/photo-1516280440503-65fef2282dc8?q=80&w=2940&auto=format&fit=crop",
  },
];

export const defaultEra = eras.find((e) => e.id === "modern_rap")!;

export function getEraById(id: string): Era | undefined {
  return eras.find((e) => e.id === id);
}
