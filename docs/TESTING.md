# Testing Vidfiddle

`npm test` runs the unit and route tests (set `TEST_DATABASE_URL` to include the database test).
This page covers the rest: checks that need a running install, and checks that need your own
accounts.

## Core path (needs only an OpenAI key)

Start the stack (`docker compose up -d`), sign in, then:

1. **Feeds:** add a real feed on RSS Feeds. Posts appear on Content as plain text, and excerpts
   don't repeat the title.
2. **Script:** on a post, choose Create Video. The Script step writes a 30–60 second script.
3. **Render:** on the Style step, Local engine is selected. Without a Creatify key, the other three
   methods are disabled. Continue through to Video. The worker renders the video in about a minute,
   and it plays in History.
4. **Auto Mode:** turn on Auto Mode for a feed. When a new post arrives, the check-feeds and
   process-queue jobs (or Test Run on Auto Mode Status) render a video into the Approval Queue.
   Approve it there.
5. **Delete:** delete a video from History. Its file is removed from storage.
6. **Pacing and music:** render the same script at Slow and Fast. Fast cuts to a new shot every
   2–3 seconds. With tracks in `music/` (or the starter pack), music plays under the voice and dips
   while it speaks; "No music" leaves only the voice.

To use S3 storage, set `STORAGE_DRIVER=s3` and the `S3_*` variables, then repeat step 3. The video
URL should point at `S3_PUBLIC_URL`, and the object should appear in the bucket.

## Checks that need your accounts

Publishing makes the platforms fetch your video from `PUBLIC_URL`, so that address must be a
public HTTPS URL. A `localhost` address won't work for these checks.

### LightPost
Upstream LightPost can't post video yet. Until it can, run LightPost from a build with video support.

1. Set `PUBLISHER=lightpost`, `LIGHTPOST_URL` and `LIGHTPOST_PASSWORD`, then restart.
2. Settings shows LightPost as **Active**, with your connected accounts listed under it.
3. Schedule a rendered video from the Schedule step. The post appears in LightPost with the video
   attached, publishes at its time, and the History card shows the platform as posted, with a link.

### Publer
1. Set `PUBLER_API_KEY` and `PUBLER_WORKSPACE_ID`, then restart. Settings shows Publer as
   **Active**, with your accounts.
2. Schedule a video. It appears in Publer and publishes.
3. The verify-publer job updates the History card to posted, with a link.
4. Give a feed some Auto Mode platforms, then approve an Auto Mode video. It schedules to those
   platforms.

### Anthropic for scripts
Set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`, then restart. Settings names Anthropic, and
the Script step writes scripts. Rendering still needs `OPENAI_API_KEY`.

### ElevenLabs music
Set `ELEVENLABS_API_KEY`, then restart. Settings shows Music as **ElevenLabs**. Each new render
composes its own instrumental in the chosen mood. With an invalid key, renders still finish, using
library tracks.

### Creatify engines (paid)
Set `CREATIFY_API_ID` and `CREATIFY_API_KEY`. AI Shorts, Link to Video and AI Avatar become
selectable on the Style step. Render one of each. The check-creatify job moves each video to
completed.

### YouTube clips
- **What works with no extra keys:** the worker downloads the video (yt-dlp) and cuts clips.
- **Transcription needs `DEEPGRAM_API_KEY`.** Without it, a source stops with "Deepgram API not
  configured".
- **Captioned clips need `CREATOMATE_API_KEY`.**
- **`SUBMAGIC_API_KEY` replaces the whole pipeline** with Submagic's Magic Clips.

Paste a YouTube link on YouTube Clips. The source moves through downloading, transcribing,
analyzing and processing, and the clips appear with captions.
