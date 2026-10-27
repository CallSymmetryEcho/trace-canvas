#!/usr/bin/env python3
"""Neural narration with mlx-audio on Apple Silicon, for make.mjs.

Reads a JSON list of jobs on stdin, {"text", "out", "model", "voice", "lang", "instruct"?, "temperature"?, "top_p"? (Qwen3), "speed"? (Kokoro),
"takes"?, "target"? {"hz", "range"}}, and writes one WAV file per job. Each model is loaded once.
"""
import json
import re
import sys

import numpy as np
from mlx_audio.audio_io import write
from mlx_audio.tts.utils import load_model

LANGUAGE = {'en': 'English', 'zh': 'Chinese'}  # Qwen3-TTS
LANG_CODE = {'en': 'a', 'zh': 'z'}  # Kokoro
SEC_PER_CHAR = {'en': 0.08, 'zh': 0.3}  # rough speaking rate, for the length cap


def read(job, m):
    # Qwen3 makes 12 codec tokens per second. Cap a line at about twice its expected length: at low
    # temperatures a voice sometimes never ends the line, and such a take is thrown away and read again.
    cap = int(12 * (len(job['text']) * SEC_PER_CHAR[job['lang']] * 2 + 4))
    for attempt in range(3):
        if 'Kokoro' in job['model']:
            results = m.generate(text=job['text'], voice=job['voice'], lang_code=LANG_CODE[job['lang']], speed=job.get('speed', 1.0))
        else:
            results = m.generate_custom_voice(text=job['text'], speaker=job['voice'], language=LANGUAGE[job['lang']], instruct=job.get('instruct'),
                                              temperature=job.get('temperature'), top_p=job.get('top_p'), max_tokens=cap)
        audio = np.concatenate([np.array(r.audio) for r in results])
        if 'Kokoro' in job['model'] or len(audio) / m.sample_rate < cap / 12 - 1:
            return audio
        print(f"{job['out']}: hit the length cap, reading it again", flush=True)
    return audio


def pitch(audio, sr):
    """Median pitch (Hz) and pitch range (semitones, 10th to 90th percentile) of a take, by autocorrelation."""
    x = np.asarray(audio, dtype=np.float64)
    x = x / (np.abs(x).max() or 1)
    n, hop, lo, hi, f0 = int(sr * 0.04), int(sr * 0.01), sr // 300, sr // 70, []
    for i in range(0, len(x) - n, hop):
        f = x[i:i + n] - x[i:i + n].mean()
        if np.sqrt((f ** 2).mean()) < 0.02:
            continue
        ac = np.correlate(f, f, 'full')[n - 1:]
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.45 * ac[0]:
            f0.append(sr / k)
    if len(f0) < 10:
        return None
    st = 12 * np.log2(np.array(f0) / np.median(f0))
    return float(np.median(f0)), float(np.percentile(st, 90) - np.percentile(st, 10))


models = {}
for job in json.load(sys.stdin):
    if job['model'] not in models:
        models[job['model']] = load_model(job['model'])
    m = models[job['model']]
    # Qwen3 reads each take afresh, so one can come out much higher, flatter or more sing-song than the
    # rest. With `takes` and `target`, read the line that many times and keep the take closest to the target.
    best = None
    for take in range(job.get('takes', 1)):
        audio = read(job, m)
        if 'target' not in job:
            best = (0, audio)
            break
        p, t = pitch(audio, m.sample_rate), job['target']
        # Syllables: a Chinese character, or an English word or number, each counts as one.
        rate = (len(re.findall(r'[一-鿿]', job['text'])) + len(re.findall(r'[A-Za-z]+|\d+', job['text']))) / (len(audio) / m.sample_rate)
        score = abs(12 * np.log2(p[0] / t['hz'])) + abs(p[1] - t['range']) / 2 + abs(rate - t.get('rate', rate)) * 2 if p else float('inf')
        print(f"  take {take + 1}: " + (f"{p[0]:.0f} Hz, range {p[1]:.1f} st, {rate:.1f} syl/s, off by {score:.1f}" if p else 'no pitch found'), flush=True)
        if best is None or score < best[0]:
            best = (score, audio)
    write(job['out'], best[1], m.sample_rate, format='wav')
    print(job['out'], f'{len(best[1]) / m.sample_rate:.1f} s', flush=True)
