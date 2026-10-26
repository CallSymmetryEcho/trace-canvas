# Tutorial videos

`make.mjs` records the tutorial in English and Chinese, with no screen recorder and no manual editing:

- headless Chrome plays each scene against a throwaway data folder (the made-up `tripsplit` scenario from `docs/scenarios`), with a visible cursor and captions drawn in the page;
- macOS `say` reads the narration;
- ffmpeg joins the frames and the narration into an MP4, and the captions are also written as an `.srt` file for YouTube or Bilibili.

```bash
node docs/video/make.mjs        # both languages, about 3 minutes each to record
node docs/video/make.mjs zh     # one language
```

Output: `docs/video/out/trace-canvas-tutorial.en.mp4`, `.zh.mp4` and the `.srt` files (not committed).

Needs macOS, Google Chrome and ffmpeg (`brew install ffmpeg`). The default voices are Samantha and Tingting. A Premium or Enhanced voice sounds more natural: add one under System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, then pass its name:

```bash
TC_VOICE_EN="Zoe (Premium)" TC_VOICE_ZH="Lilian (Premium)" node docs/video/make.mjs
```

To change the video, edit `SCENES` in `make.mjs`. Each scene has a page (the app, a terminal or a title card), narration lines in both languages, and the clicks and typing that go with them. A narration line can give separate caption and spoken text, for example to have `/trace-canvas` read as "slash trace canvas".
