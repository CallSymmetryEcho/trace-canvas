#!/usr/bin/env python3
"""Neural narration with mlx-audio on Apple Silicon, for make.mjs and for voice samples.

Reads a JSON list of jobs on stdin, {"text", "out", "model", "voice", "lang", "instruct"?, "speed"? (Kokoro)},
and writes one WAV file per job. Each model is loaded once.
"""
import json
import sys

import numpy as np
from mlx_audio.audio_io import write
from mlx_audio.tts.utils import load_model

LANGUAGE = {'en': 'English', 'zh': 'Chinese'}  # Qwen3-TTS
LANG_CODE = {'en': 'a', 'zh': 'z'}  # Kokoro
models = {}
for job in json.load(sys.stdin):
    if job['model'] not in models:
        models[job['model']] = load_model(job['model'])
    m = models[job['model']]
    if 'Kokoro' in job['model']:
        results = m.generate(text=job['text'], voice=job['voice'], lang_code=LANG_CODE[job['lang']], speed=job.get('speed', 1.0))
    else:
        results = m.generate_custom_voice(text=job['text'], speaker=job['voice'], language=LANGUAGE[job['lang']], instruct=job.get('instruct'))
    audio = np.concatenate([np.array(r.audio) for r in results])
    write(job['out'], audio, m.sample_rate, format='wav')
    print(job['out'], f'{len(audio) / m.sample_rate:.1f} s', flush=True)
