# Tutorial and promo videos

One command builds two videos, each in English and Chinese: a tutorial (about 2.5 minutes) and a short promo that presents Trace Canvas as the entry point for agents (under a minute).

```bash
node docs/video/make.mjs                # both videos, both languages
node docs/video/make.mjs promo zh       # one video, one language
```

Output: `docs/video/out/trace-canvas-<tutorial|promo>.<lang>.mp4` and `.srt` caption files for YouTube or Bilibili (not committed).

How it works:

1. **Narration.** `tts.py` reads every line with a neural voice on this Mac (mlx-audio). Lines are cached by text and voice, so a re-run only reads what changed.
2. **Recording.** Headless Chrome plays the app scenes against a throwaway data folder with the made-up `tripsplit` scenario from `docs/scenarios`. It saves one clean clip per scene and logs every cursor move, click and narration cue in `remotion/public/<video>/<lang>/manifest.json`.
3. **Animation.** [Remotion](https://www.remotion.dev) (`remotion/src/Tutorial.jsx`) draws the title cards, the terminals, the cursor and click ripples, a camera that follows the cursor, and the captions, and renders the MP4. `npm run studio` in `remotion/` previews it.

To change a video, edit `SCENES` (tutorial) or `PROMO` in `make.mjs`. Each scene has a page (the app, a terminal or a title card), narration lines in both languages, and the clicks and typing that go with them. A line can give separate caption and spoken text, for example to have `/trace-canvas` read as "slash trace canvas".

## Setup (once)

Needs an Apple Silicon Mac, Google Chrome, ffmpeg (`brew install ffmpeg`), Node.js 18+ and [uv](https://docs.astral.sh/uv/).

```bash
cd docs/video
uv venv --python 3.12 .venv
VIRTUAL_ENV=.venv uv pip install mlx-audio "misaki[en]"
(cd remotion && npm install)
```

The first run downloads the voice models from Hugging Face: Kokoro-82M (about 370 MB) and Qwen3-TTS 1.7B CustomVoice (about 4.3 GB). Both are Apache-2.0 with preset voices. Remotion is free for individuals and small teams; see its [license](https://www.remotion.dev/docs/license).

## Voices

Defaults: Kokoro `af_heart` (warm female) for English and Qwen3-TTS `Ryan` (male, speaking Chinese) for Chinese. Pick others with:

```bash
TC_VOICE_EN=kokoro:am_fenrir TC_VOICE_ZH=qwen:Serena node docs/video/make.mjs
```

- Kokoro, English: `af_heart`, `af_bella`, `am_michael`, `am_fenrir`, `bm_george` and more.
- Qwen3-TTS, both languages: `Serena`, `Vivian`, `Uncle_Fu`, `Dylan` (native Chinese), `Ryan`, `Aiden` (native English). These voices also get a style instruction (`STYLE` in `make.mjs`: calm and even for Chinese, crisp for English) and a sampling temperature of 0.5 instead of 0.9 (`SAMPLING`), which keeps the delivery from swinging from line to line. At low temperatures a voice can fail to end a line; `tts.py` caps each line at about twice its expected length and reads it again if it hits the cap.
