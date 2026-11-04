# Trace Canvas promo site

A one-page site for Trace Canvas: "A map both people and agents can read" / 「人和 agent 都看得懂的地图」.

- **Background:** a git-style branch graph grows as you scroll, in three depths. Far and mid lines move slower than the page; the near line is the tour's own line, with the sections as its stations.
- **Sections:** the hero (the hand-off clip), the tutorial (a player that loads only when pressed: YouTube in English, Bilibili in Chinese), the tour (six stations), feature demos (short looping clips), latest videos (cards that open the published videos), and install with the agents it supports.
- **Language and theme:** English and Chinese, switched in place. Light and dark follow the system.

It is static and dependency-free: `index.html` with inline CSS and JS, `favicon.svg`, and the clips, posters and video covers in `media/`. There is no build step. The only external request is Google Fonts.

## Preview

```bash
python3 -m http.server -d site
```

Then open <http://localhost:8000/>.

## Media

- `media/<name>.<lang>.mp4` and `.jpg`: a silent clip and its poster. They come from `docs/video/make.mjs gifs`, which renders `docs/video/out/gif-<name>.<lang>.mp4` (no captions, no sound) before making the README GIF. For the site: `ffmpeg -i out/gif-<name>.<lang>.mp4 -vf fps=24,scale=1000:-2 -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart -an media/<name>.<lang>.mp4`, and a late frame as the poster (`-sseof -1 -frames:v 1 -q:v 4`). The phone clip (`goaledit`) is 420 wide, cropped to the phone. The hero clip (`demo`) is the READMEs' opening GIF, `docs/demo.<lang>.gif`, which was cut by hand.
- `media/cover-<video>.<lang>.jpg`: 960 × 540 covers of the published videos, scaled from the masters' `cover-wide` images.

## Adding a video

When a video is public on a platform, add its card to **Latest videos** in `index.html`, newest first: one `<a class="tut">` per language, `data-l="en"` linking YouTube or X and `data-l="zh"` linking Bilibili, each added once that language's version is public (Xiaohongshu takes no links). Add its cover to `media/`, push to `main`, and Cloudflare Pages deploys it. Only videos that have been reviewed and published go here; nothing is fetched or posted automatically.

The full tutorial goes in **The tutorial**: change the two players' `data-embed`, covers and links (and add the chapters as links with a start time, e.g. `https://youtu.be/<id>?t=75`).

Clips load near the viewport and play only while visible. With reduced motion, the graph is drawn in full, nothing moves with the scroll, and clips do not autoplay.
