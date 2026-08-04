-- MimiQ - durable project genre lane.
-- Existing projects remain compatible; new project creation writes these fields.

alter table public.projects
  add column if not exists genre_category text,
  add column if not exists genre_subgenre text;

alter table public.projects
  drop constraint if exists projects_genre_category_valid,
  drop constraint if exists projects_genre_subgenre_valid;

alter table public.projects
  add constraint projects_genre_category_valid
  check (
    genre_category is null
    or genre_category in ('trap', 'drill', 'rnb_soul', 'pop')
  ),
  add constraint projects_genre_subgenre_valid
  check (
    genre_subgenre is null
    or genre_subgenre in (
      'hard_trap',
      'dark_trap',
      'melodic_trap',
      'emo_trap',
      'pluggnb',
      'uk_melodic_drill',
      'brooklyn_ny_drill',
      'chicago_drill',
      'afro_drill',
      'pop_drill',
      'contemporary_rnb',
      'cinematic_rnb',
      'neo_soul',
      'afrobeats',
      'sad_rnb',
      'mainstream_pop',
      'dark_pop',
      'latin_trap',
      'hyperpop_digicore',
      'bedroom_pop'
    )
  );
