export const genreCategories = [
  { id: "trap", label: "Trap" },
  { id: "drill", label: "Drill" },
  { id: "rnb_soul", label: "RnB / Soul" },
  { id: "pop", label: "Pop" },
] as const;

export type GenreCategoryId = (typeof genreCategories)[number]["id"];

export const genreSubgenres = [
  { id: "hard_trap", category: "trap", label: "Hard Trap" },
  { id: "dark_trap", category: "trap", label: "Dark Trap" },
  { id: "melodic_trap", category: "trap", label: "Melodic Trap / Drake Wave" },
  { id: "emo_trap", category: "trap", label: "Emo Trap" },
  { id: "pluggnb", category: "trap", label: "Pluggnb" },
  { id: "uk_melodic_drill", category: "drill", label: "UK Melodic Drill" },
  { id: "brooklyn_ny_drill", category: "drill", label: "Brooklyn / NY Drill" },
  { id: "chicago_drill", category: "drill", label: "Chicago Drill" },
  { id: "afro_drill", category: "drill", label: "Afro Drill" },
  { id: "pop_drill", category: "drill", label: "Pop Drill / Drill RnB" },
  { id: "contemporary_rnb", category: "rnb_soul", label: "Contemporary RnB" },
  { id: "cinematic_rnb", category: "rnb_soul", label: "Cinematic RnB" },
  { id: "neo_soul", category: "rnb_soul", label: "Neo Soul" },
  { id: "afrobeats", category: "rnb_soul", label: "Afrobeats" },
  { id: "sad_rnb", category: "rnb_soul", label: "Sad RnB" },
  { id: "mainstream_pop", category: "pop", label: "Mainstream Pop" },
  { id: "dark_pop", category: "pop", label: "Dark Pop" },
  { id: "latin_trap", category: "pop", label: "Latin Trap" },
  { id: "hyperpop_digicore", category: "pop", label: "Hyperpop / Digicore" },
  { id: "bedroom_pop", category: "pop", label: "Bedroom Pop" },
] as const satisfies readonly {
  id: string;
  category: GenreCategoryId;
  label: string;
}[];

export type GenreSubgenreId = (typeof genreSubgenres)[number]["id"];

export const defaultGenreCategory: GenreCategoryId = "trap";
export const defaultGenreSubgenre: GenreSubgenreId = "melodic_trap";

export function getGenreCategory(id: string | null | undefined) {
  return genreCategories.find((category) => category.id === id) ?? null;
}

export function getGenreSubgenre(id: string | null | undefined) {
  return genreSubgenres.find((subgenre) => subgenre.id === id) ?? null;
}

export function getSubgenresForCategory(category: GenreCategoryId) {
  return genreSubgenres.filter((subgenre) => subgenre.category === category);
}

export function isGenreCategoryId(value: string): value is GenreCategoryId {
  return genreCategories.some((category) => category.id === value);
}

export function isGenreSubgenreId(value: string): value is GenreSubgenreId {
  return genreSubgenres.some((subgenre) => subgenre.id === value);
}
