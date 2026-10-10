import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // assets/ holds colocated part tests (style tokens, apply-style).
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'assets/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 60_000,
    // Four suites each launch headless Chromium + WebGPU. Run in parallel
    // they race for the GPU and time out at random (tank-tuner, scene-render,
    // parts-render). Sequential was faster too: 19s vs 33s on an M-series Mac.
    fileParallelism: false,
  },
});
