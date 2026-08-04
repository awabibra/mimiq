# mimiq

mimiq is a class project for vocal mixing and performance tracking. It lets a user keep song projects, upload vocal and beat files, compare mixes, build vocal chains, check levels, and split stems.

## Built with

- Next.js, React, and TypeScript
- Zustand for client state
- Supabase for auth, project data, and file storage
- FastAPI, librosa, SciPy, and NumPy for audio analysis
- Anthropic for explaining analysis results

## Run locally

You need Node.js 20.9 or newer and Python 3.

```bash
npm install
python3 -m venv backend/venv
backend/venv/bin/pip install -r backend/requirements.txt
```

Create `.env.local` with these values:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
AUDIO_SERVICE_URL=http://127.0.0.1:8000
```

Then start the web app and audio backend together:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Folders

```text
app/                  pages and API routes
components/           React components
lib/                  shared types, state, and helpers
backend/              FastAPI audio service
supabase/migrations/  database migrations
scripts/              local utility scripts
```
