import { execFileSync } from 'node:child_process';

// Keep real decoding and Web Audio measurements, but discard speaker output.
// PULSE_SINK is inherited only by this run's workers and their browsers; never
// change the user's default sink or move/mute existing listening sessions.
export default function setupAudio() {
  if (process.platform !== 'linux') return;
  const sink = `mix_playwright_${process.pid}`;
  let moduleId;
  try {
    moduleId = execFileSync('pactl', ['load-module', 'module-null-sink',
      `sink_name=${sink}`, 'rate=48000', 'channels=2'], { encoding: 'utf8' }).trim();
  } catch (cause) {
    throw new Error('Silent Linux tests require pactl and a running PulseAudio or PipeWire audio server.', { cause });
  }
  process.env.PULSE_SINK = sink;
  return () => { execFileSync('pactl', ['unload-module', moduleId]); };
}
