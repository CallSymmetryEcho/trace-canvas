import { Composition, registerRoot, staticFile } from 'remotion';
import { Tutorial } from './Tutorial.jsx';

const FPS = 30;
const load = async file => (await fetch(staticFile(file))).json();

// Props: { video: 'tutorial' | 'promo' | 'agents' | 'gifs', lang: 'en' | 'zh', only?: scene indexes, bare?: no captions or sound }.
// make.mjs writes public/<video>/<lang>/manifest.json and the clips and audio it names.
const calculateMetadata = async ({ props }) => {
  const full = await load(`${props.video}/${props.lang}/manifest.json`);
  const manifest = props.only ? { ...full, scenes: props.only.map(i => full.scenes[i]) } : full;
  return { durationInFrames: Math.round(manifest.scenes.reduce((s, x) => s + x.dur, 0) * FPS), props: { ...props, manifest } };
};
// Vertical: the same manifest at 1080 x 1920 for Shorts and Xiaohongshu.
const Root = () => (
  <>
    <Composition id="Tutorial" component={Tutorial} fps={FPS} width={1920} height={1080} durationInFrames={1} defaultProps={{ video: 'tutorial', lang: 'en' }} calculateMetadata={calculateMetadata} />
    <Composition id="Vertical" component={Tutorial} fps={FPS} width={1080} height={1920} durationInFrames={1} defaultProps={{ video: 'hook', lang: 'en' }} calculateMetadata={calculateMetadata} />
  </>
);
registerRoot(Root);
