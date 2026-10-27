// Plays every voice sample in turn, with its name on screen, so voices can be compared in any video player.
import { AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const GAP = 0.9;
export const reelLength = items => items.reduce((s, it) => s + it.dur + GAP, 0);

export const VoiceReel = ({ items, lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let at = 0;
  const spans = items.map(it => {
    const from = Math.round(at * fps);
    at += it.dur + GAP;
    return { ...it, from, len: Math.round(at * fps) - from };
  });
  const i = Math.max(0, spans.findIndex(s => frame >= s.from && frame < s.from + s.len));
  const c = spans[i];
  const p = Math.min(1, Math.max(0, (frame - c.from) / (c.dur * fps)));
  return (
    <AbsoluteFill style={{ background: '#f4f2ec', color: '#141414', fontFamily: '-apple-system, "PingFang SC", sans-serif', flexDirection: 'row', padding: 90, gap: 90 }}>
      {spans.map(s => (
        <Sequence key={s.file} from={s.from} durationInFrames={s.len}><Html5Audio src={staticFile(`samples/${s.file}`)} /></Sequence>
      ))}
      <div style={{ width: 640 }}>
        <div style={{ fontSize: 30, color: '#666', marginBottom: 28 }}>{lang === 'zh' ? '配音试听 · 中文' : 'Voice samples · English'}</div>
        {spans.map((s, k) => (
          <div key={s.file} style={{ fontSize: 32, padding: '10px 20px', borderRadius: 14, marginBottom: 6, background: k === i ? '#141414' : 'transparent', color: k === i ? '#fff' : '#444' }}>
            {k + 1}. {s.name} <span style={{ opacity: 0.6, fontSize: 24 }}>· {s.engine}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 40, color: '#888' }}>{i + 1} / {spans.length}</div>
        <div style={{ fontSize: 120, fontWeight: 700, lineHeight: 1.1 }}>{c.name}</div>
        <div style={{ fontSize: 40, color: '#0b57d0', margin: '14px 0 28px' }}>{c.engine}</div>
        <div style={{ fontSize: 42, color: '#333', lineHeight: 1.4 }}>{c.desc}</div>
        <div style={{ marginTop: 56, height: 12, background: '#dedbd2', borderRadius: 6 }}>
          <div style={{ width: `${p * 100}%`, height: '100%', background: '#E4002B', borderRadius: 6 }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
