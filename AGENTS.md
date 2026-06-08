# MimiQ Agent Contract

This file is the permanent working contract for MimiQ. Every agent, script, and human contributor must treat these rules as stricter than local preference.

## Product Definition

MimiQ is a serious studio-grade technical assistant for vocal mixing and performance tracking tailored for modern rap artists.

The product should feel like a serious studio tool: fast, dark, quiet, precise, and built around the artist's current project rather than around generic dashboards or marketing pages.

The existing landing page and sandbox entry transition are visual quality references, not product flow templates. Every new screen must feel like it belongs to that same product while opening directly into useful studio work.

## Product Principles

- The first screen is the usable MimiQ workspace. Do not open on a marketing dashboard, generic admin overview, onboarding wall, or explanatory landing page unless explicitly requested.
- The active project stays present across tools. The artist should always know which project, song, take, chain, and analysis context they are working on.
- Every tool is a view into the current project document, not a separate product with its own duplicate state model.
- `Level Lab` must verify whether a processed export improved. It should compare source, processed export, project targets, and reference context through measured deltas, then show improvements, regressions, and unknowns separately.
- Trust is more important than impressive claims. Prefer measured, scoped, modest output over confident-sounding guesses.
- Never claim exact chains, guaranteed professional results, radio-ready validation, professional confidence, or precise improvement unless the relevant signal was directly measured and the basis is visible to the user.

## Absolute Tech Stack

- App framework: Next.js 16 App Router.
- UI runtime: React 19.
- Language: TypeScript 5 for the web app.
- Styling: CSS Modules plus `app/globals.css`; Tailwind v4 may exist for tokens or small utilities, but component-level styling should stay explicit and local.
- Client state: Zustand only.
- Database and persistence: Supabase JS v2 and Supabase Postgres migrations.
- App API layer: Next.js route handlers under `app/api`.
- AI provider: `@anthropic-ai/sdk` where AI calls are needed.
- Audio analysis backend: FastAPI with Python 3, Uvicorn, Pydantic, librosa, soundfile, scipy, and numpy.
- Package manager: npm with the committed `package-lock.json`.
- Deployment shape: one Next app plus the existing FastAPI audio service. Do not introduce extra services, queues, workers, or runtimes unless the product cannot ship without them.

## Architecture Boundaries

- Keep the app document-driven. The active project is the source of truth; screens and tools are views into it.
- Keep route handlers thin. They validate input, call direct helpers, and return shaped responses.
- Put shared TypeScript types in `lib/types.ts` or a nearby domain file only when the type is used across files.
- Put durable client state in the existing Zustand pattern. Do not add Redux, MobX, XState, context-heavy global state, or custom event buses.
- Put Supabase access behind small direct helpers. Do not create repository classes, service classes, abstract data mappers, or ORM-style wrappers.
- Keep UI primitives in `components/ui` small and boring. Product components should live near the feature they serve.
- Keep audio science in the FastAPI backend when it depends on librosa, scipy, soundfile, or numpy. Keep UI orchestration in Next.
- Do not move audio science into the browser unless explicitly scoped as a fallback. Browser-side fallback analysis must be labeled as degraded and must expose what was skipped or approximated.
- Keep migrations explicit in `supabase/migrations`. Do not mutate schema from application runtime code.
- Fallback behavior must be explicit in API responses and UI state. If the system falls back because the audio backend, metrics, project context, storage, or AI provider is unavailable, expose the fallback source, reason, and limitations.
- Prefer one clear function over a class hierarchy. Prefer a plain object over a framework-shaped abstraction.
- Do not add microservices, GraphQL, tRPC, background job systems, dependency injection containers, analytics frameworks, design-system generators, or codegen pipelines without a written product reason in this file.

## Anti-Enterprise Coding Style

- Use simple names: `track`, `take`, `chain`, `mix`, `score`, `note`, `project`.
- Write direct code. Avoid redundant `Manager`, `Controller`, `Service`, `Repository`, `Factory`, `Provider`, and `Adapter` layers.
- Do not wrap a library just to hide the library.
- Do not split files until the split makes the current code easier to read.
- Do not create generic abstractions for one caller.
- Do not add defensive boilerplate for impossible states; model the state clearly instead.
- Keep comments rare and useful. Explain why a decision exists, not what a line does.
- Keep tests focused on behavior that can break: audio scoring, persistence, API contracts, and tool state transitions.
- Delete dead code when touching the area. Do not leave commented-out code paths.

## Project-as-a-Window

MimiQ uses a document-driven "Project-as-a-Window" paradigm.

- A project is the main working document.
- The visible app is a window into the current project, not a collection of separate apps.
- Project data includes the artist context, song or session context, takes, vocal notes, reference targets, mix chains, level decisions, analysis results, and performance history.
- The current project must remain present across tool changes.
- Saving, loading, sharing, and analysis should operate on the project document first.
- Routes may exist for deep links, but they must not fracture the mental model into unrelated pages.

## Tools-as-Tabs

MimiQ tools are tabs over the same project document.

- `Mix Room`, `Level Lab`, `Vault`, onboarding, and future tools must read from and write to the active project context.
- A tool may own its local UI controls, but it must not own a duplicate project model.
- Switching tabs should preserve project state, selected take, active chain, and relevant analysis context.
- Tool navigation should feel like moving around one studio window, not launching new products.
- Shared project actions belong in the window shell. Tool-specific actions belong inside the active tab.
- Tool switching must preserve measured analysis results and their metadata, including whether the result came from the FastAPI backend, a labeled fallback, saved project data, or user-provided context.

## Visual Design Rules

- Theme: cinematic dark: deep, material, alive.
- Background: near-black with subtle depth. Use a root variable such as `--bg: #050505` as the base, but surfaces may use slight elevation through layered transparency or noise texture. Do not make every screen flat uniform black.
- Surface: dark panels with material presence. Use a slight 1px lighter border highlight on the top edge to suggest depth. Cards should feel like they exist in space, not like they are printed on a wall.
- Borders: 1px low-contrast only. Use a root variable such as `--line: #242424`.
- Glassmorphism is permitted and used. Frosted dark panels with `backdrop-filter: blur(...)` are part of the design language when subtle and purposeful, not decorative.
- Glassmorphism must not be used for structural layout. Use it only for floating panels, modals, and overlays.
- Accent: one isolated high-visibility accent only. Use a root variable such as `--accent: #d7ff3f`. Use it sparingly for active states, key actions, and live indicators.
- Text: quiet off-white for primary text, muted gray for secondary text.
- Radius: 8-12px for cards and panels.
- Shadows: layered and dimensional. Cards should have a soft deep shadow suggesting elevation. Active elements may have a faint accent-colored glow when it orients the user, not when it is merely decorative.
- Motion is non-negotiable. Every major state transition must have intentional animation.
- Page loads must use staggered fade-in with subtle upward drift, like the sandbox entry screen.
- Tool switching must crossfade, not hard cut.
- Data appearing, including chain generation and analysis results, must build in sequentially rather than all at once.
- Buttons and interactive elements need smooth hover states and scale on press.
- Use CSS transitions and keyframes for simple motion. Use Framer Motion for complex sequences.
- Graphics and texture are permitted and encouraged.
- Subtle noise grain overlays at low opacity are encouraged on backgrounds to add material feel.
- Waveform visualizations should feel alive: animated, responsive to data, and connected to the user's audio.
- Tool icons should be crisp and considered, not generic.
- Empty states should include a graphic, not just text.
- Reference quality bar: the existing landing page and sandbox entry animation, including the dot, falling text, and slow fade-in, is the quality standard. Every screen should feel like it belongs to the same product as that moment.
- No gradient-orb backgrounds.
- No oversized decorative blobs.
- No purple-blue SaaS gradients.
- No beige, cream, sand, espresso, or warm lifestyle palettes.
- Do not build anything that looks like a Notion template or generic SaaS dashboard.
- Use icons for tools and compact actions when a known icon exists.
- Keep controls dense, aligned, and scannable. This is a working studio surface, not a landing page.

## Layout Rules

- The first screen must be the usable MimiQ workspace.
- Do not build a marketing landing page unless explicitly requested.
- Treat the project window as the stable frame: persistent context, tabbed tools, and one active work area.
- Avoid cards inside cards.
- Avoid floating page sections styled as cards.
- Use full-width dark bands or unframed layouts for page structure.
- Keep fixed-format controls dimensionally stable with explicit size, grid, or aspect-ratio rules.
- Text must never overlap, clip awkwardly, or depend on viewport-scaled font sizing.
- Letter spacing stays at `0` unless matching an existing logo asset.

## Data And Audio Rules

- Store durable user and project data in Supabase.
- Keep temporary UI-only state in Zustand.
- Keep uploaded or analyzed audio handling explicit. Do not silently persist audio beyond the intended project workflow.
- Any score, recommendation, or diagnosis must be traceable to the take, chain, project settings, and analysis version that produced it.
- `Level Lab` evaluations must compare the processed export against the original take and any selected target/reference using deterministic measurements where available. If MimiQ cannot verify improvement, it must say so plainly.
- Separate measured deltas from interpretation. Store and display enough detail for the user to see what changed, what improved, what regressed, and what could not be measured.
- AI output should assist the artist and engineer by explaining measured signals, project context, and user-provided notes. It must not pretend to hear details that were not analyzed or provided.
- Do not invent confidence. Confidence must come from deterministic measurements, calibration data, repeatable comparisons, or explicit user feedback. Otherwise, show uncertainty or omit confidence entirely.
- Do not silently replace real analysis with AI-only, mock, cached, browser-only, or metadata-only results. Any fallback must be visible in the response shape and in the user-facing state.
- Never claim exact plugin chains, guaranteed professional results, or radio-ready validation unless the app directly measured the relevant audio and can show the evidence.

## Claim Language

- Use claim levels that match the evidence: `measured`, `estimated`, `inferred from project context`, `user-provided`, or `unknown`.
- Prefer language like "the measured loudness increased by..." or "the export appears closer to the selected target on..." over broad claims like "this is radio-ready" or "this chain fixes the mix."
- When analysis is incomplete, say what is missing. Missing audio, missing reference targets, failed backend analysis, short clips, clipped files, or fallback-only checks must reduce the strength of the recommendation.
- AI explanations may recommend next steps, but they must not create facts, exact settings, or certainty beyond the measurements and project context.

## Change Discipline

- Make the smallest change that solves the product problem.
- Preserve the existing stack and file organization unless a local file clearly needs to move.
- Before adding a dependency, prove that the existing stack cannot do the job cleanly.
- Before adding a new global pattern, use a local helper.
- Do not create or modify unrelated application files while updating this contract.
- Keep diffs minimal, reviewable, and tied to the active request.
- Run relevant lint, tests, type checks, migrations checks, or targeted verification for the touched area.
- Report the commands run and their results, including skipped checks and why they were skipped.
- Done means fallback behavior is explicit, project data remains the source of truth, and every user-facing claim is backed by measurement, labeled context, or a clear unknown.
