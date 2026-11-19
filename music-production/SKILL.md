---
name: music-production
description: "Music creation: songwriting craft, Suno AI prompts, HeartMuLa local generation, and audio visualization."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [music, audio, songwriting, suno, heartmula, spectrogram, generation]
    related_skills: [audiocraft-audio-generation, comfyui]
---

# Music Production

Umbrella for all music-related skills: songwriting craft, AI music generation (Suno, HeartMuLa), and audio analysis/visualization.

---

## Songwriting & Suno AI

### Song structure (pick one or invent)
```
ABABCB  Verse/Chorus/Verse/Chorus/Bridge/Chorus  (most pop/rock)
AABA    Verse/Verse/Bridge/Verse  (jazz, ballads)
AAA     Verse/Verse/Verse  (folk, storytelling)
```

### Suno prompt engineering
**Style field formula:** Genre + Mood + Era + Instruments + Vocal Style + Production + Dynamics

**Example:**
```
"Cinematic orchestral spy thriller, 1960s Cold War era, smoky sultry female vocalist,
big band jazz, brass section with trumpets, sweeping strings, minor key, vintage analog warmth"
```

**Key tips:**
- V4.5+ supports up to 1,000 chars in Style field
- NO artist names or trademarks
- Describe the dynamic JOURNEY: "Begins as haunting whisper over sparse piano, gradually layers muted brass, builds through chorus..."
- Build a vocal PERSONA, not just gender
- Use Custom Mode always (separate Style + Lyrics fields)

### Metatags in lyrics
```
[Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]
[Whispered] [Belted] [Falsetto] [Harmonies]
[Building Energy] [Explosive] [Quiet arrangement]
```

### Parody/adaptation
1. Map original's structure (syllables, rhyme scheme, stressed syllables)
2. Match stressed syllables to same beats
3. On held notes, match vowel sounds
4. Keep some original lines for recognizability

### Phonetic tricks for AI singers
- Spell words as they sound: "through" → "thru"
- ALL CAPS = louder/intense; vowel extension: "lo-o-o-ove"
- Spell out numbers: "24/7" → "twenty four seven"

---

## HeartMuLa (Open-Source Music Generation)

Local Suno alternative. Generates music from lyrics + tags.

**Install:**
```bash
git clone https://github.com/HeartMuLa/heartlib.git && cd heartlib
uv venv --python 3.10 .venv && . .venv/bin/activate && uv pip install -e .
# Fix dependency conflicts:
uv pip install --upgrade datasets transformers
# Patch source code (RoPE cache + HeartCodec loading) — see full skill details
```

**Hardware:** Minimum 8GB VRAM with `--lazy_load true`; 16GB+ recommended.

**Usage:**
```bash
python ./examples/run_music_generation.py \
  --model_path=./ckpt --version="3B" \
  --lyrics="./assets/lyrics.txt" --tags="./assets/tags.txt" \
  --save_path="./assets/output.mp3" --lazy_load true
```

**Tags format:** `piano,happy,wedding,synthesizer,romantic`
**Lyrics format:** Use `[Intro]`, `[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]` structural tags.

**Pitfalls:**
- Do NOT use bf16 for HeartCodec — degrades quality. Use fp32.
- Tags may be ignored (known issue); lyrics tend to dominate
- RTF ≈ 1.0 — a 4-minute song takes ~4 minutes to generate

---

## Audio Visualization (songsee)

Generate spectrograms and multi-panel audio feature visualizations.

**Install:** `go install github.com/steipete/songsee/cmd/songsee@latest`

**Usage:**
```bash
songsee track.mp3                                    # Basic spectrogram
songsee track.mp3 --viz spectrogram,mel,chroma,mfcc  # Multi-panel grid
songsee track.mp3 --start 12.5 --duration 8 -o slice.jpg  # Time slice
```

**Visualization types:** `spectrogram`, `mel`, `chroma`, `hpss`, `selfsim`, `loudness`, `tempogram`, `mfcc`, `flux`

Output images can be inspected with `vision_analyze` for automated audio analysis.
