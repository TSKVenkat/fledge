import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';

/**
 * Size the worker pool by memory, not by processor count.
 *
 * Every test file that touches the database starts its own in-process
 * Postgres, which is the reason an integration test is cheap to write but not
 * free to run. A pool sized to the CPU count starts more of them than the
 * machine can hold, and they fail on timeouts that look like flakiness rather
 * than like memory pressure. MemAvailable is the right number here: `free`
 * memory excludes reclaimable cache and understates what is actually usable.
 */
const MEMORY_PER_WORKER = 900 * 1024 * 1024;

function workerCount(): number {
  try {
    const line = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m);
    if (line?.[1]) {
      const available = Number(line[1]) * 1024;
      return Math.max(1, Math.min(4, availableParallelism() - 1, Math.floor(available / MEMORY_PER_WORKER)));
    }
  } catch {
    // Not Linux, or /proc unreadable: fall through to a conservative default.
  }
  return Math.max(1, Math.min(2, availableParallelism() - 1));
}

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    environment: 'node',
    // Password hashing dominates the API tests otherwise. Four rounds is
    // meaningless for security and irrelevant here; production reads the same
    // variable and is left at its default.
    env: { BCRYPT_ROUNDS: '4' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: workerCount(),
    minWorkers: 1,
  },
});
