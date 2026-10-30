# Your music

Drop background tracks here and Vidfiddle mixes them under the narration of local-engine videos.
File each track under a mood, either in a folder or with a file-name prefix:

```
music/upbeat/sunny-groove.mp3
music/calm-rain-piano.mp3
```

The moods are `upbeat`, `calm`, `inspiring`, `dramatic` and `playful`. The planner picks one per
video (or you choose it on the Style step), and a matching track is picked at random. A track with
no mood is used when nothing matches. MP3, M4A, AAC, WAV, OGG and FLAC all work. Tracks loop or are
trimmed to the video's length, so any length is fine.

These sit alongside the starter tracks in `assets/music`. Without Docker, set `MUSIC_DIR` to use
a different folder (the default is `DATA_DIR/music`). With `ELEVENLABS_API_KEY` set, Vidfiddle
composes a fresh track for each video instead, and falls back to these tracks if that fails.

Use only music you have the rights to publish.
