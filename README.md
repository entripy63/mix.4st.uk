# mix.4st.uk
website

## Automated Playback Basics Tests

This repository includes Playwright end-to-end tests for core player behavior.

Run the suite with:

```bash
npm run test:e2e
```

Quick/full verification commands:

```bash
npm run verify:quick
npm run verify:full
npm run verify:sensitivity
```

CI-only full matrix commands (Chromium + Firefox + WebKit + iPhone WebKit):

```bash
npm run verify:full:ci
npm run verify:sensitivity:ci
```

What is covered:

1. DJ mix playback starts and `currentTime` increases while playing.
2. Live stream playback path is exercised (`playStream`), including pause/resume UI states (`LIVE` / `PAUSED`).
3. A second E2E tier uses real browser media decode with controlled local test endpoints for both mix and stream playback.
4. Sensitivity checks inject controlled playback faults at runtime and verify that core invariants fail (proving tests can detect regressions).

Notes:

1. Tests run against `player.html` via `tools/test-server.js`.
2. Browser media and audio context are mocked in the tests for deterministic, low-flake checks.
3. Local real-media endpoints are available at `/__test__/mix.wav` and `/__test__/stream.wav` for integration-level playback checks.
4. Playwright projects run on Chromium, Firefox, WebKit, and an iPhone-emulated WebKit profile.

## Recommended Workflow Gates

1. Install local hooks once per clone: `npm run hooks:install`.
2. `pre-commit` hook runs `npm run verify:quick`.
3. `pre-push` hook runs `npm run verify:full`.
4. GitHub Actions workflow [`.github/workflows/verify.yml`](file:///home/st/git/mix.4st.uk/.github/workflows/verify.yml) runs `npm run verify:full` for pull requests and pushes to `main`.
5. GitHub Actions runs `npm run verify:full:ci` and `npm run verify:sensitivity:ci` (full browser matrix including WebKit + iPhone WebKit).
6. `./tools/deploy.sh` now enforces checks before deploy: test targets run quick checks, production runs full checks.
7. Emergency bypass for deploy checks is available with `SKIP_DEPLOY_CHECKS=1 ./tools/deploy.sh <target>`.
