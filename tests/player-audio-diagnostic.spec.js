import { expect, test } from '@playwright/test';

// Temporary CI controls: isolate the finite WAV failure from the app's player.
for (const attachment of ['none', 'before-load', 'after-canplay']) {
  test(`finite WAV with WebAudio attachment: ${attachment}`, async ({ page }) => {
    await page.goto('/robots.txt');
    await page.mouse.click(1, 1);
    const samples = await page.evaluate(async attachment => {
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      document.body.append(audio);
      let context;
      let analyser;

      async function attachWebAudio() {
        context = new AudioContext();
        analyser = context.createAnalyser();
        context.createMediaElementSource(audio).connect(analyser).connect(context.destination);
        await context.resume();
      }

      if (attachment === 'before-load') await attachWebAudio();
      const ready = new Promise((resolve, reject) => {
        audio.addEventListener('canplay', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error(audio.error.message)), { once: true });
      });
      audio.src = '/__test__/mix.wav';
      await ready;
      if (attachment === 'after-canplay') await attachWebAudio();
      await audio.play();

      function sample() {
        let rms = null;
        if (analyser) {
          const data = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(data);
          rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
        }
        return {
          mediaTime: audio.currentTime,
          contextTime: context?.currentTime,
          contextState: context?.state,
          rms,
          paused: audio.paused,
          error: audio.error?.message || null
        };
      }

      await new Promise(resolve => setTimeout(resolve, 300));
      const start = sample();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const end = sample();
      audio.pause();
      if (context) await context.close();
      return { attachment, start, end };
    }, attachment);

    console.log(`::notice title=Audio control ${attachment}::${JSON.stringify(samples)}`);
    expect(samples.end.mediaTime, JSON.stringify(samples, null, 2)).toBeGreaterThan(samples.start.mediaTime + 0.3);
  });
}
