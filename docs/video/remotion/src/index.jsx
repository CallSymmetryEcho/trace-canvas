import { Composition, registerRoot, staticFile } from 'remotion';
import { Tutorial } from './Tutorial.jsx';
import { VoiceReel, reelLength } from './VoiceReel.jsx';

const FPS = 30;
const load = async file => (await fetch(staticFile(file))).json();

// Props: { video: 'tutorial' | 'promo', lang: 'en' | 'zh', only?: scene indexes, bare?: no captions or sound }.
// make.mjs writes public/<video>/<lang>/manifest.json and the clips and audio it names.
const Root = () => (
  <>
    <Composition id="Tutorial" component={Tutorial} fps={FPS} width={1920} height={1080} durationInFrames={1} defaultProps={{ video: 'tutorial', lang: 'en' }}
      calculateMetadata={async ({ props }) => {
        const full = await load(`${props.video}/${props.lang}/manifest.json`);
        const manifest = props.only ? { ...full, scenes: props.only.map(i => full.scenes[i]) } : full;
        return { durationInFrames: Math.round(manifest.scenes.reduce((s, x) => s + x.dur, 0) * FPS), props: { ...props, manifest } };
      }} />
    <Composition id="VoiceReel" component={VoiceReel} fps={FPS} width={1920} height={1080} durationInFrames={1} defaultProps={{ lang: 'en' }}
      calculateMetadata={async ({ props }) => {
        const items = (await load('samples/reel.json'))[props.lang];
        return { durationInFrames: Math.round(reelLength(items) * FPS), props: { ...props, items } };
      }} />
  </>
);
registerRoot(Root);
