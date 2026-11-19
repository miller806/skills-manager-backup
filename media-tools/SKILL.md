---
name: media-tools
description: "Media utilities: GIF search/download, Spotify playback, and YouTube transcript processing."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [media, GIF, Spotify, YouTube, playback, transcripts]
    related_skills: [music-production]
---

# Media Tools

Umbrella for media-related utilities: GIFs, music playback, and video transcript processing.

---

## GIF Search (Tenor)

Search and download GIFs from Tenor via curl + jq.

```bash
# Search for GIFs
curl -s "https://tenor.googleapis.com/v2/search?q=happy&key=API_KEY&limit=5" | jq '.results[] | {url, media_formats}'
```

Use for: finding reaction GIFs, animated content for messages or posts.

---

## Spotify

Play, search, queue, manage playlists and devices via Spotify API.

**When to use:** User wants to control Spotify playback, search for music, manage playlists, or switch devices.

**Common operations:**
- Search for tracks, artists, albums, playlists
- Play/pause/skip/resume playback
- Queue tracks
- Transfer playback between devices
- Create/modify playlists
- Get currently playing track info

---

## YouTube Content

Process YouTube transcripts into summaries, Twitter threads, or blog posts.

**When to use:** User provides a YouTube URL and wants a summary, thread, or blog post from the video content.

**Workflow:**
1. Extract transcript from YouTube video
2. Process transcript based on desired output format
3. Generate summary, thread, or blog post
