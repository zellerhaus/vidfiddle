# Vidfiddle

Self-hosted tool that turns blog posts (RSS, URL, YouTube) into short vertical videos and schedules them to
social media. See README.md for what it does and how to run it.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Database:** PostgreSQL through Drizzle ORM (`src/db`)
- **Styling:** Tailwind CSS 4 + shadcn/ui primitives restyled as BlockFrame (see Design below), Lucide icons
- **Deployment:** docker compose (`app`, `worker`, `postgres`)
- **APIs:** OpenAI or Anthropic (text), OpenAI (local video engine), Creatify (optional hosted video),
  Publer or LightPost (publishing), Deepgram/Creatomate/Submagic (optional YouTube clips)

## Commands

```bash
npm run dev          # web app (localhost:3000)
npm run worker       # worker: migrations, cron schedule, local renders, YouTube jobs
npm test             # node:test via tsx (TEST_DATABASE_URL enables the DB-backed test)
npm run lint
npx tsc --noEmit
npm run db:generate  # after editing src/db/schema.ts
npm run migrate      # apply migrations
```

## Project Structure

```
src/
├── app/                  # Next.js App Router pages and route.ts API handlers
│   ├── api/cron/         # Scheduled jobs; the worker calls them with CRON_SECRET
│   ├── api/webhooks/     # Publer and Submagic callbacks
│   └── media/[...key]/   # Serves local-disk media with Range support (public)
├── components/           # Feature folders + ui/ (shadcn primitives)
├── db/                   # Drizzle schema, lazy client, migrator (adopts pre-Drizzle databases)
├── worker/               # Worker process: cron runner, render loop, YouTube download/cut
└── lib/
    ├── video-engine/     # Local engine: scene planning, TTS, images, word timing, ffmpeg
    ├── local-engine.ts   # Contract for local-engine videos between app and worker
    ├── llm.ts            # complete(): OpenAI or Anthropic, chosen by LLM_PROVIDER
    ├── claude.ts         # Script and caption generation (provider-neutral despite the name)
    ├── storage.ts        # local disk or S3-compatible storage, public URLs
    ├── publishers/       # getPublisher(): Publer or LightPost behind one interface
    ├── publer.ts, creatify.ts, creatomate.ts, submagic.ts, deepgram.ts
    └── supabase/types.ts # Shared types; row types are inferred from src/db/schema.ts
drizzle/                  # Generated migrations (0000 is the production baseline)
tests/                    # node:test files
```

## Architecture & Patterns

### No Server Actions
- **Pages** are async server components that query the database directly through `db`.
- **Client components** call API routes with `fetch()`.
- **API routes** export `GET`/`POST`/`PUT`/`DELETE` from `route.ts`.

Every page renders on demand (`dynamic = "force-dynamic"` in the root layout); never query the
database at build time.

### Database
- `import { db } from "@/db"` and tables from `@/db/schema`. Schema property names equal the column
  names (snake_case), so rows serialize to the JSON shapes the frontend expects.
- Timestamps are ISO strings (a custom column type), not `Date`s.
- Drizzle throws on errors. Catch around queries where a route needs a specific status code.
- Nested API responses (e.g. a video with its `blog_posts`) are built with joins and explicit mapping.
  Keep the nested key named after the table.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`. Never edit a generated migration
  that has shipped.

### Local engine contract
A local-engine video is a `videos` row with `status: "pending"`, no `creatify_job_id`, and
`style_options.apiVersion: "local"` (`LocalEngineOptions`). The worker claims it with
`FOR UPDATE SKIP LOCKED`, renders, stores `generated/<id>.mp4`, writes captions, and sets
`approval_status: "pending_review"`. The app never calls the engine directly.
`LocalEngineOptions` also carries `pacing` (slow/medium/fast: shots of ~whole scene/4s/2.5s cut on
word starts, `shotLengths` in the pipeline) and `music` (auto/a mood/none) with `musicVolume`.
Build options with `buildLocalEngineOptions`; it normalizes loose request and settings values.

### Engine audio
Every render ends in `finishAudio` (src/lib/video-engine/ffmpeg.ts): narration leveled to about
-14 LUFS (raw TTS is ~-30), plus an optional music bed about 15 dB under the voice with sidechain
ducking. Music providers live in `src/lib/video-engine/music.ts`: a mood-filed library
(`assets/music` + `MUSIC_DIR`) and ElevenLabs Music, chosen by `musicFromEnv`.

### Media
Use `src/lib/storage.ts`: `saveFile`, `publicUrl`, `keyFromUrl`, `localPath`. Social platforms fetch
media by URL, so stored media must be reachable at `PUBLIC_URL` (or `S3_PUBLIC_URL`).

### Design (BlockFrame)

The UI shares the launch videos' look. Tokens live in `src/app/globals.css`:
- Black borders and hard offset shadows (`shadow-hard` 8px, `shadow-hard-sm` 4px; the `shadow-*` scale is redefined as zero-blur offsets). Square corners everywhere; pills (`Badge`) are the only rounded shapes.
- Candy palette: `bg-pastel-pink|blue|green|yellow|cream` on an offwhite ground (`dot-grid` utility for the faint dot pattern). Primary is yellow with black text.
- Status colors are semantic badge variants: `success` (done), `info` (in progress), `warning`, `destructive` (failed), `pink`. Don't hard-code Tailwind palette colors (`text-green-500` etc.).
- Type: Inter (body 500, `.display` = 900 uppercase tight for headings and big numbers), Space Grotesk via `.label-chrome` for pills, eyebrows and nav.
- Platform chip colors come from `src/lib/platform-colors.ts`.
- Brand: `VidfiddleMark` / `VidfiddleWordmark` in `src/components/brand.tsx`; the same mark is `src/app/icon.svg`.

## Authentication

Single-user, password-based, with HMAC-signed session cookies (`src/lib/auth.ts`). `src/middleware.ts`
enforces auth except on `/login`, `/api/auth/`, `/media/` (unguessable keys), and `/api/cron/` and
`/api/webhooks/` (self-authenticated via `CRON_SECRET` or a signature).

## External API Notes

| API      | File                  | Notes                                                                    |
| -------- | --------------------- | ------------------------------------------------------------------------ |
| Text     | `src/lib/llm.ts`      | Anthropic SDK or OpenAI Responses API over fetch.                        |
| Creatify | `src/lib/creatify.ts` | Trailing slashes required on endpoints. Check `isCreatifyConfigured()`.  |
| Publer   | `src/lib/publer.ts`   | Upload media from URL → poll → schedule → poll job. HMAC webhooks.      |
| LightPost | `src/lib/publishers/lightpost.ts` | Session-cookie login; imports media by public URL; one post per account. |

## Environment Variables

`.env.example` is the reference; keep it in sync when adding a setting.
