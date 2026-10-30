# Vidfiddle

Turn blog posts into short vertical videos and schedule them to social media. Self-hosted, with one
`docker compose up`.

Point it at an RSS feed (or paste a URL, or a YouTube link). It splits each post into a few video-sized
ideas, writes a 30–60 second script for each in your brand voice, renders the videos, writes a caption
per platform, and queues everything for your review before anything is posted.

## How it works

```
RSS / URL / YouTube → segments → script → video → review queue → captions → scheduled posts
```

- **Scripts and captions** come from OpenAI or Anthropic (`LLM_PROVIDER`).
- **Videos** come from one of two engines:
  - **Local engine (OpenAI):** renders on your server. `gpt-4o-mini-tts` reads the script, `gpt-image`
    draws a still for each scene, `whisper-1` times every word, and ffmpeg cuts each still into shots
    with camera moves, burns in word-by-word captions, and mixes music under the voice. About
    **$0.06 for a 30-second video**, billed to your OpenAI account.
    - **Pacing:** slow (a new picture about every 8 seconds), medium (a new shot about every 4) or
      fast (every 2–3). Same cost at every pace.
    - **Music:** matched to the script's mood, from the starter tracks in `assets/music` plus any
      you drop into `music/` ([how](music/README.md)). Set `ELEVENLABS_API_KEY` to compose a fresh
      track per video instead. Narration is leveled to -14 LUFS, the loudness social apps expect.
  - **[Creatify](https://creatify.ai):** hosted stock-footage and AI-avatar videos (paid, optional).
- **Publishing** goes through [Publer](https://publer.com) (hosted, paid) or
  [LightPost](https://github.com/brainstormity/LightPost) (self-hosted, free).
- **YouTube clips:** finds the most shareable moments in a long video and cuts captioned clips
  (optional; uses Deepgram plus Creatomate or Submagic).

Auto mode runs the whole pipeline on new feed posts daily. Videos still wait in the review queue for
approval.

## Quick start

Requirements: Docker with Compose, and an OpenAI API key.

```bash
git clone https://github.com/zellerhaus/vidfiddle.git
cd vidfiddle
cp .env.example .env    # set APP_PASSWORD, CRON_SECRET, WORKER_SECRET and OPENAI_API_KEY
docker compose up -d
```

Open http://localhost:3000 and sign in with `APP_PASSWORD`. Add a feed under **Feeds**, pick a post under
**Content**, and convert it. Choose **Local engine (OpenAI)** in the style step.

Compose starts three services:

| Service    | What it does                                                                |
| ---------- | --------------------------------------------------------------------------- |
| `app`      | The web app (Next.js) on port 3000                                          |
| `worker`   | Runs migrations, scheduled jobs, local-engine renders and YouTube downloads |
| `postgres` | The database                                                                |

Videos and images live in the `media` volume. Back up both volumes, `postgres` and `media`.

## Configuration

Everything is set in `.env`. [`.env.example`](.env.example) documents each setting. The ones that matter
most:

| Setting                                  | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `APP_PASSWORD`                           | The single login. This is a one-person app.                             |
| `CRON_SECRET`, `WORKER_SECRET`           | Shared secrets between the app and the worker. Any long random strings. |
| `OPENAI_API_KEY`                         | Scripts, captions and the local video engine.                           |
| `ANTHROPIC_API_KEY`, `LLM_PROVIDER`      | Use Claude for scripts and captions instead.                            |
| `PUBLIC_URL`                             | The app's public address. See below.                                    |
| `STORAGE_DRIVER`, `S3_*`                 | Keep media on local disk (default) or in an S3-compatible bucket.       |
| `PUBLER_*` or `PUBLISHER`, `LIGHTPOST_*` | Where scheduled posts go.                                               |
| `CREATIFY_*`                             | The hosted Creatify engine, if you want it.                             |
| `MUSIC_DIR`, `ELEVENLABS_API_KEY`        | Your own music folder, or ElevenLabs-composed music per video.          |
| `CRON_<JOB>`                             | Change a job's schedule (5-field cron), or turn it `off`.               |

### Media must be reachable for publishing

Instagram, Facebook, Threads, Publer and LightPost all fetch your video **by URL**. If you schedule
posts, either:

- set `PUBLIC_URL` to an address the internet can reach (a domain behind a reverse proxy, or a tunnel
  such as Cloudflare Tunnel), or
- use `STORAGE_DRIVER=s3` with a public bucket (Cloudflare R2, Backblaze B2, AWS S3) and `S3_PUBLIC_URL`.

Rendering and reviewing work fine on a private network; only publishing needs this.

### Publishing with LightPost

LightPost is a small self-hosted scheduler. Video support for Instagram Reels, Facebook Pages, Threads
and LinkedIn is in progress upstream. Set `PUBLISHER=lightpost`, `LIGHTPOST_URL` and
`LIGHTPOST_PASSWORD`, and connect your accounts in LightPost. To pick specific accounts, set
`LIGHTPOST_ACCOUNTS=instagram=<id>,linkedin=<id>`; otherwise every connected account for a platform is
used.

## Running without Docker

You need Node.js 22+, PostgreSQL 15+, and an ffmpeg built with libass (for burned-in captions; Debian
and Ubuntu packages include it, and on macOS use `brew install ffmpeg-full`). yt-dlp is needed only for
YouTube clips.

```bash
npm ci
cp .env.example .env    # also set DATABASE_URL, WORKER_URL and APP_INTERNAL_URL
npm run migrate
npm run build && npm start    # the web app
npm run worker                # in another terminal
```

To try the engine on its own, render any script to MP4 without the app or a database:

```bash
OPENAI_API_KEY=... npx tsx scripts/render-video.ts --script post.txt --out video.mp4 --aspect 9x16
```

## Development

```bash
npm run dev            # web app with hot reload
npm run worker         # worker
npm test               # unit tests
npm run lint
npx tsc --noEmit
```

- The database schema lives in [`src/db/schema.ts`](src/db/schema.ts). After changing it, run
  `npm run db:generate` to write a migration to `drizzle/`. `npm run migrate` (and the worker, at
  startup) applies it.
- One test writes to a real database. Point `TEST_DATABASE_URL` at a disposable Postgres to run it;
  otherwise it is skipped.
- The local engine is in [`src/lib/video-engine/`](src/lib/video-engine). Each stage (scene planning,
  voice, images, word timing) is a small interface, so adding a provider such as ElevenLabs voices or
  Pexels footage means writing one class.

## Moving from the original hosted setup

Earlier versions ran on Vercel with Supabase. To move an existing install:

1. Set `DATABASE_URL` to your Supabase Postgres connection string (or restore a dump into the compose
   database). On first start, the worker recognizes the existing schema and records the baseline
   migration as already applied. Nothing is recreated.
2. Videos already stored in Supabase Storage keep working as external URLs. New media goes to the
   storage driver you configure.
3. Replace `RAILWAY_WORKER_URL`/`RAILWAY_WORKER_SECRET` with `WORKER_URL`/`WORKER_SECRET` (the old
   names still work), and remove the Vercel cron configuration: the worker runs the schedule now.

## License

[MIT](LICENSE). The bundled caption font, Anton, is under the [SIL Open Font License](assets/fonts/OFL.txt).
