#!/usr/bin/env python3
"""CosyVoice 3 narration for make.mjs, run on a CUDA machine from the root of a CosyVoice checkout.

Reads {"prompt_wav", "prompt_text", "jobs": [{"text", "out"}]} on stdin and writes one WAV file per job. Every line
is read in the voice of the same reference clip, which keeps the delivery even from line to line.
"""
import json
import sys

sys.path[:0] = ['.', 'third_party/Matcha-TTS']
import torch
import torchaudio
from cosyvoice.cli.cosyvoice import AutoModel

req = json.load(sys.stdin)
m = AutoModel(model_dir='pretrained_models/Fun-CosyVoice3-0.5B')
prompt = 'You are a helpful assistant.<|endofprompt|>' + req['prompt_text']
for job in req['jobs']:
    parts = m.inference_zero_shot(job['text'], prompt, req['prompt_wav'], stream=False)
    audio = torch.cat([p['tts_speech'] for p in parts], dim=1)
    torchaudio.save(job['out'], audio, m.sample_rate)
    print(job['out'], f'{audio.shape[1] / m.sample_rate:.1f} s', flush=True)
