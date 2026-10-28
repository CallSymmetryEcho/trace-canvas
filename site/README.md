# Trace Canvas promo site

A one-page site for Trace Canvas: "A map both people and agents can read" / 「人和 agent 都看得懂的地图」.

- **Background:** a git-style branch graph grows as you scroll, in three depths. Far and mid lines move slower than the page; the near line is the tour's own line, with the sections as its stations.
- **Sections:** the tour (eight stations), then feature demos (short looping clips), tutorials (cards that open the published videos), and install.
- **Language and theme:** English and Chinese, switched in place. Light and dark follow the system.

It is static and dependency-free: `index.html` with inline CSS and JS, `favicon.svg`, and the clips, posters and video covers in `media/`. There is no build step. The only external request is Google Fonts.

## Preview

```bash
python3 -m http.server -d site
```

Then open <http://localhost:8000/>.

## Media

- `media/<name>.<lang>.mp4` and `.jpg`: each clip is the README GIF of the same name in `docs/` (`docs/gif-<name>.<lang>.gif`, or `docs/demo.<lang>.gif`), with a poster image.
- `media/cover-<video>.<lang>.jpg`: covers of the published videos.

Clips load near the viewport and play only while visible. With reduced motion, the graph is drawn in full, nothing moves with the scroll, and clips do not autoplay.
