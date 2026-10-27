// The tutorial: title cards, terminals and recorded app clips, with a cursor, click ripples, a slow
// camera that follows the cursor, captions and narration, all driven by public/<lang>/manifest.json.
import { AbsoluteFill, Html5Audio, Easing, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const C = { bg: '#f4f2ec', ink: '#141414', muted: '#555', link: '#0b57d0', lines: ['#E4002B', '#0072CE', '#00A651', '#F29F05'] };
const FONT = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
const MONO = '"SF Mono", Menlo, "PingFang SC", monospace';
const W = 1920, H = 1080, S = 1.5; // the app was recorded at 1280 x 720 CSS px, scale 1.5
const ZOOM = 1.15;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const ease = Easing.inOut(Easing.cubic);

export const Tutorial = ({ manifest, bare }) => {
  const { fps } = useVideoConfig();
  const { scenes } = manifest;
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      {scenes.map((s, i) => {
        const from = Math.round(at * fps);
        at += s.dur;
        const len = Math.round(at * fps) - from;
        // Consecutive app scenes are one continuous shot: no fade and no zoom-out between them.
        const joinPrev = scenes[i - 1]?.kind === s.kind, joinNext = scenes[i + 1]?.kind === s.kind;
        return (
          <Sequence key={i} from={from} durationInFrames={len}>
            <Scene s={s} len={len} joinPrev={joinPrev} joinNext={joinNext} charSec={manifest.charSec} bare={bare} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Scene = ({ s, len, joinPrev, joinNext, charSec, bare }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const opacity = interpolate(f, [0, 8, len - 8, len], [joinPrev ? 1 : 0, 1, 1, joinNext ? 1 : 0], CLAMP);
  return (
    <AbsoluteFill style={{ opacity }}>
      {s.kind === 'card' && <Card s={s} f={f} fps={fps} />}
      {s.kind === 'terminal' && <Terminal s={s} t={t} f={f} fps={fps} charSec={charSec} />}
      {s.kind === 'app' && <App s={s} t={t} T={len / fps} zoomIn={!joinPrev} zoomOut={!joinNext} />}
      {!bare && s.lines.map((l, i) => (
        <Sequence key={i} from={Math.round(l.t * fps)}><Html5Audio src={staticFile(l.audio)} /></Sequence>
      ))}
      {!bare && <Caption lines={s.lines} t={t} top={s.captionAt === 'top'} />}
    </AbsoluteFill>
  );
};

/* ---------- title and closing cards: a small transit map draws itself ---------- */
const Card = ({ s, f, fps }) => {
  const p = spring({ frame: f - 4, fps, config: { damping: 200 }, durationInFrames: 40 });
  const q = spring({ frame: f - 18, fps, config: { damping: 200 } });
  const r = spring({ frame: f - 34, fps, config: { damping: 200 } });
  const stations = [[110, 120, 0], [300, 120, 0], [520, 120, 0], [740, 120, 0], [890, 120, 0], [380, 40, 1], [640, 40, 1], [470, 200, 2], [720, 200, 2]];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: C.ink }}>
      <svg width={1000} height={240} viewBox="0 0 1000 240" style={{ marginBottom: 36 }}>
        {['M60 120 H940', 'M220 120 C300 120 300 40 380 40 H640 C720 40 720 120 800 120', 'M380 120 C440 120 430 200 470 200 H940'].map((d, i) => (
          <path key={i} d={d} pathLength={1} fill="none" stroke={C.lines[i]} strokeWidth={14} strokeLinecap="round" strokeDasharray={1} strokeDashoffset={1 - p} />
        ))}
        {stations.map(([x, y, line], i) => (
          <circle key={i} cx={x} cy={y} r={13} fill="#fff" stroke={C.lines[line]} strokeWidth={7} opacity={p > x / 1000 ? 1 : 0} />
        ))}
      </svg>
      <div style={{ fontSize: 132, fontWeight: 700, letterSpacing: -3, opacity: q, transform: `translateY(${(1 - q) * 30}px)` }}>{s.big}</div>
      <div style={{ fontSize: 46, color: C.muted, marginTop: 20, opacity: r }}>{s.small}</div>
      {s.foot && <div style={{ fontFamily: MONO, fontSize: 42, color: C.link, marginTop: 52, opacity: r }}>{s.foot}</div>}
    </AbsoluteFill>
  );
};

/* ---------- terminal: commands type themselves, output appears line by line ---------- */
const TERM = { p: '#7ee787', o: '#b9c0cc', k: '#d2a8ff', '': '#e6e6e6' };
const Terminal = ({ s, t, f, fps, charSec }) => {
  const parts = [];
  for (const st of s.steps) {
    if (t < st.t) break;
    if (st.cmd != null) {
      const n = Math.min(st.cmd.length, Math.floor((t - st.t) / charSec));
      parts.push(['p', st.prompt], ['', st.cmd.slice(0, n) + (n === st.cmd.length ? '\n' : '')]);
    } else parts.push([st.cls || 'o', `${st.out}\n`]);
  }
  const enter = spring({ frame: f, fps, config: { damping: 200 }, durationInFrames: 20 });
  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 110 }}>
      <div style={{ width: 1560, height: 700, borderRadius: 18, background: '#16181d', boxShadow: '0 30px 90px rgba(0,0,0,.25)', overflow: 'hidden', transform: `scale(${0.96 + 0.04 * enter})`, opacity: enter }}>
        <div style={{ height: 52, background: '#2a2d34', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', color: '#aab', fontSize: 20 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map(c => <i key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
          <span style={{ flex: 1, textAlign: 'center', marginRight: 84 }}>{s.title}</span>
        </div>
        <pre style={{ margin: 0, padding: '28px 36px', font: `30px/1.55 ${MONO}`, color: TERM[''], whiteSpace: 'pre-wrap' }}>
          {parts.map(([c, x], i) => <span key={i} style={{ color: TERM[c] }}>{x}</span>)}
          <span style={{ display: 'inline-block', width: 15, height: 32, verticalAlign: -6, background: '#e6e6e6', opacity: Math.floor(t * 2) % 2 ? 0 : 1 }} />
        </pre>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- recorded app clip with cursor, ripples and camera ---------- */
// Where the cursor is at time t: each move glides from the previous target to its own in `ms`.
function cursorAt(s, t) {
  let from = s.start, last = null;
  for (const e of s.cursor) {
    if (e.click) continue;
    if (e.t > t) break;
    if (last) from = last;
    last = e;
  }
  if (!last) return s.start;
  const k = ease(Math.min(1, (t - last.t) / (last.ms / 1000)));
  return { x: from.x + (last.x - from.x) * k, y: from.y + (last.y - from.y) * k };
}

const App = ({ s, t, T, zoomIn, zoomOut }) => {
  const pos = cursorAt(s, t);
  // The camera looks at the average cursor position of the last 0.7 s, so it drifts instead of jumping.
  let cx = 0, cy = 0;
  for (let k = 0; k < 10; k++) { const p = cursorAt(s, Math.max(0, t - k * 0.07)); cx += p.x / 10; cy += p.y / 10; }
  const ramp = Math.min(0.9, T / 3);
  const z = interpolate(t, [0, ramp, T - ramp, T], [zoomIn ? 1 : ZOOM, ZOOM, ZOOM, zoomOut ? 1 : ZOOM], { ...CLAMP, easing: ease });
  const ox = Math.min(0, Math.max(W - W * z, W / 2 - cx * S * z));
  const oy = Math.min(0, Math.max(H - H * z, H / 2 - cy * S * z));
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'absolute', width: W, height: H, transformOrigin: '0 0', transform: `translate(${ox}px, ${oy}px) scale(${z})` }}>
        <OffthreadVideo src={staticFile(s.clip)} muted style={{ width: W, height: H }} />
        {s.cursor.filter(e => e.click && t >= e.t && t < e.t + 0.6).map((e, i) => {
          const k = (t - e.t) / 0.6;
          return <div key={i} style={{ position: 'absolute', left: e.x * S - 33, top: e.y * S - 33, width: 66, height: 66, borderRadius: 33, border: '5px solid rgba(37,99,235,.9)', transform: `scale(${0.3 + 1.3 * k})`, opacity: 1 - k }} />;
        })}
        <svg viewBox="0 0 24 24" width={40} height={40} style={{ position: 'absolute', left: pos.x * S - 6.5, top: pos.y * S - 3.3, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.3))' }}>
          <path d="M4 2l15 10.5-6.6 1.3 3.9 7.4-2.8 1.5-3.9-7.5L4 20z" fill="#111" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- captions ---------- */
const Caption = ({ lines, t, top }) => {
  const l = [...lines].reverse().find(x => t >= x.t);
  if (!l) return null;
  const end = l.t + l.dur + 0.3;
  if (t > end) return null;
  const a = interpolate(t, [l.t, l.t + 0.2, end - 0.2, end], [0, 1, 1, 0], CLAMP);
  return (
    <div style={{ position: 'absolute', left: '50%', [top ? 'top' : 'bottom']: top ? 120 : 64, transform: `translate(-50%, ${(1 - a) * (top ? -12 : 12)}px)`, opacity: a,
      maxWidth: 1560, width: 'max-content', padding: '14px 32px', borderRadius: 18, background: 'rgba(18,18,20,.86)', color: '#fff', fontSize: 40, lineHeight: 1.4, fontWeight: 500, textAlign: 'center' }}>
      {l.text}
    </div>
  );
};
