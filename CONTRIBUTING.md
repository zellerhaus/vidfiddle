# Contributing to Vidfiddle

Thanks for helping. Bug reports, docs fixes, new providers and small UI improvements are all welcome.
For anything bigger than a bug fix, open an issue or a discussion first so we can agree on the shape
before you spend a weekend on it.

## Where help is most useful

- **Engine providers.** Each stage of the local engine is a small interface (see below). A Pexels or
  stock-footage visual provider, another TTS voice, or a local Whisper transcriber would each be one
  class plus a test.
- **Visual styles.** New presets for the Style step, with a sample image.
- **Publishers.** Another scheduler behind the `getPublisher()` interface in `src/lib/publishers/`.
- **Docs.** If something in the README tripped you up, fix it for the next person.

Issues labeled [`good first issue`](https://github.com/zellerhaus/vidfiddle/labels/good%20first%20issue)
are small and well scoped.

## Setup

You need Node.js 22+, PostgreSQL 15+ and an ffmpeg built with libass (on macOS,
`brew install ffmpeg-full`). The quickest Postgres is a throwaway container:

```bash
docker run -d --name vidfiddle-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17-alpine

npm ci
cp .env.example .env    # set APP_PASSWORD, CRON_SECRET, OPENAI_API_KEY, and the
                        # "Running without Docker" block at the bottom, with
                        # DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
npm run migrate
npm run dev             # web app on http://localhost:3000
npm run worker          # in another terminal
```

`CLAUDE.md` doubles as an architecture guide: how pages, API routes, the database, the worker and the
local engine fit together. It's worth a skim before your first change.

## Before you open a pull request

CI runs these on every pull request; run them locally first.

```bash
npm run lint
npx tsc --noEmit
npm test
```

One test writes to a real database and is skipped unless `TEST_DATABASE_URL` is set. Give it its own
database so it never touches your dev data:

```bash
docker exec vidfiddle-pg createdb -U postgres vidfiddle_test
export TEST_DATABASE_URL=postgres://postgres:dev@localhost:5432/vidfiddle_test
DATABASE_URL=$TEST_DATABASE_URL npm run migrate
npm test
```

For changes you can only see in a running app (a render, publishing, Auto Mode), walk through the
relevant part of [docs/TESTING.md](docs/TESTING.md) and say in the PR what you checked.

## Conventions

- **No server actions.** Pages are async server components that query the database; client components
  call API routes with `fetch()`.
- **Schema changes** go in `src/db/schema.ts`, followed by `npm run db:generate`. Never edit a migration
  that has already shipped.
- **UI** uses the BlockFrame tokens in `src/app/globals.css`: black borders, hard shadows, the pastel
  palette and semantic badge variants. Don't hard-code Tailwind palette colors such as `text-green-500`.
- **Copy** in the app and docs is short and plain. Say what a thing does.
- **Settings:** a new environment variable gets a commented entry in `.env.example`.
- **Commits** are one imperative sentence describing the change, like `Add Pexels footage provider` or
  `Snap shot cuts to word starts`. No prefixes.

## Adding an engine provider

The stage interfaces live in [`src/lib/video-engine/types.ts`](src/lib/video-engine/types.ts):

| Interface | Job |
| --- | --- |
| `ScenePlanner` | Splits a script into scenes and picks a style and mood |
| `VoiceProvider` | Reads one scene to an audio file, with neighboring scenes as context |
| `VisualProvider` | Draws one still per scene |
| `Transcriber` | Returns word timings for the caption track |
| `MusicProvider` | Finds or composes a music bed for a mood |

Write the class, report what it spends through the `CostSink` it's given, and wire it up in
[`src/lib/video-engine/providers/index.ts`](src/lib/video-engine/providers/index.ts) (or `music.ts` for
music). [`tests/elevenlabs-voice.test.ts`](tests/elevenlabs-voice.test.ts) shows how to test a provider
against a stubbed `fetch`, so tests never call a paid API.

## Reporting bugs and security issues

Open a [bug report](https://github.com/zellerhaus/vidfiddle/issues/new/choose) with your setup (Docker
or not, storage driver, publisher) and the worker log around the failure. Please report security
problems privately; see [SECURITY.md](SECURITY.md).

By contributing, you agree that your work is released under the [MIT License](LICENSE). Everyone taking
part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
