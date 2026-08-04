# mimiq Agent Contract

This file is the permanent working contract for mimiq.
Every agent, script, and human contributor treats these rules as stricter than local preference.

---

## How to Read This File

Codex: load this file fully before touching any file. Do not skim. Every section is active.
When a task conflicts with a rule here, stop and ask — do not resolve the conflict by ignoring the rule.

---

## Product Definition

mimiq is a technical assistant for vocal mixing and performance tracking tailored for modern rap artists.

It must feel like a serious studio tool: fast, dark, quiet, precise, built around the artist's current project — not around generic dashboards or marketing pages.

The existing landing page and sandbox entry transition are the visual quality reference. Every new screen must belong to that same product while opening directly into useful studio work.

---

## Codex Operating Rules

These rules govern how Codex behaves on every task, regardless of what is asked.

### Before writing any code

1. Read this entire file.
2. Identify every file the task will touch: components, route handlers, Supabase migrations, Zustand stores, FastAPI routes, shared types, CSS modules, and globals.
3. List those files explicitly before writing a single line of code.
4. If a Supabase migration is required, write it first and list it in the plan. Do not mutate schema from application runtime code.
5. If the task touches `lib/types.ts` or any shared type, update the type definition before updating callers.
6. If the task touches the FastAPI backend, verify the Python contract before updating the Next.js caller.

### Token efficiency rules

- Do not repeat context already established in this file. Reference it by section name.
- Do not re-explain what a function does if it already has a clear name and the behavior is obvious.
- Do not emit boilerplate comments (`// handle error`, `// return result`). Only write comments that explain a non-obvious decision.
- Do not emit unused imports, dead variables, or unreachable branches.
- When making a small change, patch only the affected lines. Do not rewrite entire files.
- When asked to plan, produce a numbered list of files + changes only. No prose narrative.

### Hallucination prevention rules

- Never invent a library, API endpoint, Supabase table, or environment variable that does not already exist in this repo.
- If you are uncertain whether a table, column, or function exists, state the uncertainty and ask before proceeding.
- If a type imported from `lib/types.ts` does not exist, add it to `lib/types.ts` — do not fabricate it inline.
- Never claim a feature is implemented until the code is written and the relevant check passes.
- Never assume a FastAPI endpoint exists unless you have read the Python source.
- If the audio backend is unreachable, return a structured fallback response — never mock data as real analysis.

### Change discipline rules

- Make the smallest change that solves the product problem.
- Do not touch unrelated files.
- Do not rename variables, restructure folders, or refactor patterns unless explicitly asked.
- Do not add a dependency without proving the existing stack cannot do the job.
- Do not add a global pattern when a local helper works.
- Run `npm run lint` and `npx tsc --noEmit` after every change. Report the result.
- If a Supabase migration was written, state what command runs it and what the expected schema change is.
- Done means: fallback behavior is explicit, project state is the source of truth, every user-facing claim is backed by measurement or labeled as estimated/unknown.

### Verification checklist (run before marking done)

- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] Any new Supabase table/column has a migration file in `supabase/migrations/`
- [ ] Any new API route handler validates input and returns a shaped response
- [ ] Any new FastAPI endpoint has been added to the Python source and tested locally or documented as pending
- [ ] No mock data is returned as real analysis
- [ ] All new UI state lives in Zustand, not local component state, if it needs to persist across tool switches
- [ ] Motion rules (see Visual Design) are satisfied for any new screen or transition

---

## Project Map

Understanding this map is required before any task. If a file is missing from what you expect, check here first — do not create a parallel version.

```
app/
  layout.tsx              — root shell, project window frame, Zustand hydration
  globals.css             — all CSS custom properties (--bg, --accent, --line, etc.)
  page.tsx                — entry point; opens directly to the mimiq workspace
  api/                    — Next.js route handlers (thin: validate → helper → respond)
    audio/                — proxies or orchestrates FastAPI calls
    project/              — project CRUD
    eval/                 — E-Val comparison endpoints
  (tools)/                — tool tab views, all reading from active project context
    sandbox/
    mix-room/
    level-lab/
    stem-splitter/
    vocal-diagnostics/

components/
  ui/                     — small, boring primitives (Button, Input, Badge, etc.)
  shell/                  — project window frame, tab bar, project context header
  waveform/               — WaveSurfer.js wrappers; must feel alive and animated
  [feature]/              — product components live near the feature they serve

lib/
  types.ts                — all shared TypeScript types; add here before using elsewhere
  supabase.ts             — Supabase client singleton
  store.ts                — Zustand store (active project, take, chain, analysis context)
  audio.ts                — client-side audio helpers (non-science; science stays in FastAPI)

supabase/
  migrations/             — every schema change lives here as a timestamped SQL file

backend/                  — FastAPI service (Python 3, librosa, soundfile, scipy, numpy)
  main.py
  routers/
  models/
```

If you need to create a file outside this structure, state why and confirm before creating it.

---

## Absolute Tech Stack

Do not introduce anything outside this list without a written reason in this file.

- **App framework:** Next.js 16 App Router
- **UI runtime:** React 19
- **Language:** TypeScript 5
- **Styling:** CSS Modules + `app/globals.css`; Tailwind v4 for tokens/utilities only — component styling is explicit and local
- **Client state:** Zustand only
- **Database:** Supabase JS v2 + Supabase Postgres migrations
- **API layer:** Next.js route handlers under `app/api`
- **AI provider:** `@anthropic-ai/sdk`
- **Audio backend:** FastAPI, Python 3, Uvicorn, Pydantic, librosa, soundfile, scipy, numpy
- **Package manager:** npm with committed `package-lock.json`
- **Animation:** CSS transitions and keyframes for simple motion; Framer Motion for complex sequences
- **Waveform:** WaveSurfer.js

Banned: Redux, MobX, XState, tRPC, GraphQL, class-based repositories, service layers, abstract data mappers, microservices, background queues, analytics frameworks, codegen pipelines.

---

## Architecture Rules

- **Document-driven.** Active project is the source of truth. Screens are views into it.
- **Thin route handlers.** Validate input → call helper → return shaped response. No business logic in handlers.
- **Shared types go in `lib/types.ts`.** Only when used across files.
- **Supabase access via small direct helpers.** No classes, no wrappers.
- **Audio science stays in FastAPI.** librosa, scipy, soundfile, numpy → backend only.
- **Browser-side fallback analysis must be labeled degraded** and must expose what was skipped.
- **Fallback behavior is explicit** in API responses and UI state. Always expose: fallback source, reason, limitations.
- **One clear function over a class hierarchy.**
- **Zustand for durable client state.** Tool-local ephemeral state may use React state.
- **Migrations explicit in `supabase/migrations/`.** Never mutate schema from runtime code.

---

## Project-as-a-Window

mimiq is one window into one active project. This is not a collection of pages.

- A project holds: artist context, song/session context, takes, vocal notes, reference targets, mix chains, level decisions, analysis results, performance history.
- The active project persists across tool changes. It is never lost on a tab switch.
- Every tool reads from and writes to the active project context. No tool owns its own duplicate project model.
- Saving, loading, sharing, and analysis operate on the project document first.
- Routes may exist for deep links but must not fracture the mental model.

---

## Tools-as-Tabs

Tools are tabs over the same project document.

- `Collision Check`, `E-Val`, `Vault`, and all future tools read from and write to the active project.
- Switching tabs preserves: project state, selected take, active chain, analysis context.
- Tool navigation feels like moving around one studio window, not launching new products.
- Shared project actions belong in the window shell. Tool-specific actions belong inside the active tab.
- Measured analysis results and their metadata persist across tab switches, including whether the result came from FastAPI, a labeled fallback, saved project data, or user-provided context.

---

## E-Val Rules

E-Val is a comparison tool. It must never be a marketing claim generator.

- Compare: source take, processed export, project targets, reference context.
- Show: measured deltas, improvements, regressions, unknowns — separately.
- Use claim levels: `measured`, `estimated`, `inferred from project context`, `user-provided`, `unknown`.
- Never claim improvement without a measured delta.
- Never claim "radio-ready", "professional", or "guaranteed" anything.
- If the audio backend is unavailable: show what could not be measured and why.

---

## Visual Design Rules

These are not suggestions. Every screen and component must satisfy them.

### Core palette (CSS custom properties in `globals.css`)

```css
--bg: #050505;          /* root background */
--surface: #0d0d0d;     /* card/panel base */
--line: #242424;        /* borders, 1px only */
--accent: #d7ff3f;      /* one accent, used sparingly */
--text: #e8e8e0;        /* primary text, quiet off-white */
--text-muted: #6b6b6b;  /* secondary text */
--radius: 10px;         /* cards and panels */
```

### Surface rules

- Background: near-black with subtle depth. Surfaces use layered transparency or noise texture — not flat uniform black.
- Cards: 1px top-edge highlight to suggest depth. Cards exist in space, not printed on a wall.
- Glassmorphism: permitted for floating panels, modals, overlays only. Never for structural layout.
- Borders: 1px, `--line` only.
- Shadows: layered and dimensional. Cards have soft deep shadows. Active elements may have faint accent glow when it orients — not when decorative.
- Radius: 8–12px for cards and panels.

### Motion rules (non-negotiable)

Every major state transition must have intentional animation. These are required, not optional:

- **Page load:** staggered fade-in with subtle upward drift (like the sandbox entry screen)
- **Tool switch:** crossfade, never a hard cut
- **Data appearing** (chain generation, analysis results): sequential build-in, not all-at-once
- **Buttons/interactive elements:** smooth hover states, scale on press
- **Waveform:** animated, responsive to data, alive — not a static image

Use CSS transitions and keyframes for simple motion. Use Framer Motion for complex sequences.

### Graphics and texture

- Subtle noise grain overlay at low opacity on backgrounds — adds material feel, not decoration.
- Waveform visualizations feel alive: animated, data-responsive, connected to the user's audio.
- Tool icons: crisp and considered, not generic.
- Empty states: include a graphic, not just text.
- Reference quality: the landing page sandbox entry animation (dot, falling text, slow fade-in) is the floor. Every screen belongs to that product.

### Hard bans

- No gradient-orb backgrounds
- No oversized decorative blobs
- No purple-blue SaaS gradients
- No beige, cream, sand, espresso, warm lifestyle palettes
- No Notion-template or generic SaaS dashboard aesthetics
- No letter spacing unless matching an existing logo asset
- No viewport-scaled font sizing
- No text overlap or awkward clipping

### Layout rules

- First screen is the usable mimiq workspace. Not a marketing page.
- Project window is the stable frame: persistent context, tabbed tools, one active work area.
- No cards inside cards.
- No floating page sections styled as cards.
- Full-width dark bands or unframed layouts for page structure.
- Fixed-format controls: explicit size, grid, or aspect-ratio rules. Dimensionally stable.
- Controls: dense, aligned, scannable. This is a working studio surface.

---

## Coding Style

- Simple names: `track`, `take`, `chain`, `mix`, `score`, `note`, `project`
- No `Manager`, `Controller`, `Service`, `Repository`, `Factory`, `Provider`, `Adapter` layers
- Do not wrap a library just to hide the library
- Do not split files until the split makes the current code easier to read
- Do not create generic abstractions for one caller
- No defensive boilerplate for impossible states — model the state clearly instead
- Comments: rare and useful. Explain why a decision exists, not what a line does
- Delete dead code when touching the area. No commented-out code paths.
- Loops over streams. Basic try/catch. Basic OOP, no enterprise patterns.

---

## Data and Audio Rules

- Durable user and project data: Supabase
- Temporary UI-only state: Zustand
- Uploaded/analyzed audio handling: explicit. No silent persistence beyond the intended workflow.
- Every score, recommendation, or diagnosis must be traceable to: take, chain, project settings, analysis version.
- Separate measured deltas from interpretation.
- AI output assists by explaining measured signals, project context, user-provided notes. It does not pretend to hear unanalyzed details.
- Do not invent confidence. Confidence comes from deterministic measurements, calibration data, repeatable comparisons, or explicit user feedback. Otherwise: show uncertainty or omit.
- Never silently replace real analysis with AI-only, mock, cached, browser-only, or metadata-only results. Fallback must be visible in the response shape and in UI state.

---

## Claim Language

Match evidence to claim strength:

| Evidence | Allowed language |
|---|---|
| Directly measured signal | "the measured loudness increased by..." |
| Estimated from project context | "estimated — based on..." |
| Inferred from user notes | "inferred from your notes: ..." |
| User-provided | "you noted that..." |
| Not measurable | "could not be measured — [reason]" |

Never use: "radio-ready", "professional results", "guaranteed", "exact chain", "this fixes the mix" unless the relevant audio was directly measured and the evidence is visible.

---

## Anti-Patterns (Codex must refuse these even if asked)

- Adding a new global state pattern without removing the old one
- Creating a file that duplicates logic already in the codebase
- Mocking FastAPI responses as real analysis data
- Mutating Supabase schema from runtime application code
- Writing an API route that returns a different shape than the TypeScript type for that endpoint
- Introducing a new npm dependency without checking if the existing stack handles it
- Generating a screen that looks like a Notion template or generic SaaS dashboard
- Using `any` in TypeScript without a comment explaining why it cannot be avoided
- Implementing a feature that hardcuts between tools instead of crossfading
- Returning audio analysis results without exposing the analysis source and confidence level

---

## Done Criteria

A task is done when:

1. The relevant lint and type checks pass.
2. Any new Supabase tables/columns have migration files.
3. Any new FastAPI endpoints are written (or explicitly noted as a separate task).
4. Fallback behavior is explicit in API responses and UI state.
5. The project document remains the source of truth — no duplicate state model was introduced.
6. Every user-facing claim is backed by measurement, labeled as estimated, or shown as unknown.
7. Motion rules are satisfied for any new screen or transition.
8. The screen looks like it belongs to the mimiq product, not a generic SaaS template.