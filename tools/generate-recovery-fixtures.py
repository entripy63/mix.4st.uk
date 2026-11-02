"""Regenerate tests/fixtures/recovery-*.mp3; needs system libmp3lame, not CI."""
import array
import ctypes as c
import math
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
root.mkdir(exist_ok=True)
rate = 44100
phase = 0.0
samples = array.array('f')
seed = 71
for i in range(rate * 20):
    t = i / rate
    phase += 2 * math.pi * (190 + 1.3 * t + 37 * math.sin(t * 0.73)) / rate
    seed = (1664525 * seed + 1013904223) & 0xffffffff
    samples.append(0.22 * math.sin(phase) + 0.04 * (seed / 0xffffffff - 0.5))
pcm = (c.c_float * len(samples)).from_buffer(samples)
lib = c.CDLL('libmp3lame.so.0')
lib.lame_init.restype = c.c_void_p
for name in ['lame_set_in_samplerate', 'lame_set_num_channels', 'lame_set_brate', 'lame_set_quality']:
    getattr(lib, name).argtypes = [c.c_void_p, c.c_int]
lib.lame_init_params.argtypes = [c.c_void_p]
lib.lame_encode_buffer_ieee_float.argtypes = [c.c_void_p, c.POINTER(c.c_float), c.POINTER(c.c_float), c.c_int, c.c_void_p, c.c_int]
lib.lame_encode_flush.argtypes = [c.c_void_p, c.c_void_p, c.c_int]
lib.lame_close.argtypes = [c.c_void_p]
for bitrate in [128, 160]:
    encoder = lib.lame_init()
    assert encoder
    for name, value in [('lame_set_in_samplerate', rate), ('lame_set_num_channels', 1), ('lame_set_brate', bitrate), ('lame_set_quality', 2)]:
        assert getattr(lib, name)(encoder, value) == 0
    assert lib.lame_init_params(encoder) == 0
    output = c.create_string_buffer(int(len(samples) * 1.25 + 7200))
    size = lib.lame_encode_buffer_ieee_float(encoder, pcm, pcm, len(samples), output, len(output))
    assert size > 0
    data = output.raw[:size]
    size = lib.lame_encode_flush(encoder, output, len(output))
    assert size >= 0
    data += output.raw[:size]
    lib.lame_close(encoder)
    (root / f'recovery-{bitrate}.mp3').write_bytes(data)
    print(f'{bitrate} kbps: {len(data)} bytes of synthetic test audio')
