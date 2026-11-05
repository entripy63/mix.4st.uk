"""Generate quiet, reservoir-free MP3 tone/silence; requires libmp3lame locally."""
import array
import ctypes as c
import math
from pathlib import Path
import sys

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
lib = c.CDLL('libmp3lame.so.0')
lib.lame_init.restype = c.c_void_p
for name in ['lame_set_in_samplerate', 'lame_set_num_channels', 'lame_set_brate',
             'lame_set_quality', 'lame_set_disable_reservoir', 'lame_set_bWriteVbrTag']:
    getattr(lib, name).argtypes = [c.c_void_p, c.c_int]
lib.lame_init_params.argtypes = [c.c_void_p]
lib.lame_encode_buffer_ieee_float.argtypes = [c.c_void_p, c.POINTER(c.c_float),
                                           c.POINTER(c.c_float), c.c_int, c.c_void_p, c.c_int]
lib.lame_encode_flush.argtypes = [c.c_void_p, c.c_void_p, c.c_int]
lib.lame_close.argtypes = [c.c_void_p]
for name in ['tone', 'silence']:
    samples = array.array('f', (0.04 * math.sin(2 * math.pi * 440 * i / 44100)
                               if name == 'tone' else 0 for i in range(44100 * 4)))
    pcm = (c.c_float * len(samples)).from_buffer(samples)
    encoder = lib.lame_init()
    assert encoder
    for key, value in [('lame_set_in_samplerate', 44100), ('lame_set_num_channels', 1),
                       ('lame_set_brate', 128), ('lame_set_quality', 2),
                       ('lame_set_disable_reservoir', 1), ('lame_set_bWriteVbrTag', 0)]:
        assert getattr(lib, key)(encoder, value) == 0
    assert lib.lame_init_params(encoder) == 0
    output = c.create_string_buffer(int(len(samples) * 1.25 + 7200))
    size = lib.lame_encode_buffer_ieee_float(encoder, pcm, pcm, len(samples), output, len(output))
    assert size > 0
    data = output.raw[:size]
    size = lib.lame_encode_flush(encoder, output, len(output))
    assert size >= 0
    data += output.raw[:size]
    lib.lame_close(encoder)
    (root / f'{name}.mp3').write_bytes(data)
    print(f'{name}: {len(data)} bytes')
