# mimiq Audio Backend

FastAPI + librosa audio analysis service.

## Local dev

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Test: `curl http://localhost:8000/health`

## Deploy to Railway

1. Push this folder as a separate repo (or subdirectory)
2. Railway auto-detects Python from `requirements.txt`
3. Set `PORT` env var (Railway sets this automatically)
4. Copy the Railway public URL → set `AUDIO_SERVICE_URL=https://your-url.railway.app` in Next.js `.env.local`

## API

POST /analyze
- Form field `vocal`: audio file (.wav or .mp3, up to 60s)
- Form field `beat`: audio file (optional)

Returns: { vocal: AudioMetrics, beat: AudioMetrics | null, frequency_collisions: [...] }
