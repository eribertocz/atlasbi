import { setTimeout as delay } from 'node:timers/promises';

import { LakehouseError } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import {
  retryWhileCatalogBusy,
  WriteSerializer,
} from '../../src/adapters/duckdb/write-serializer.ts';
import { ENGINE_MESSAGES } from '../fixtures/engine-messages.ts';

const FAST = { attempts: 3, initialDelayMs: 1, backoffFactor: 2 };

describe('WriteSerializer', () => {
  it('never runs two writes at once, and keeps their order', async () => {
    const serializer = new WriteSerializer();
    const events: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const write = (name: string, ms: number) =>
      serializer.run(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        events.push(`start ${name}`);
        await delay(ms);
        events.push(`end ${name}`);
        running -= 1;
        return name;
      });

    const results = await Promise.all([write('a', 20), write('b', 1), write('c', 5)]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps serializing after a write fails', async () => {
    const serializer = new WriteSerializer();

    const failed = serializer.run(() => Promise.reject(new Error('boom')));
    const next = serializer.run(() => Promise.resolve('ok'));

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});

describe('retryWhileCatalogBusy', () => {
  it('retries a locked catalog and succeeds once the lock is gone', async () => {
    let calls = 0;
    const result = await retryWhileCatalogBusy(() => {
      calls += 1;
      return calls < 3
        ? Promise.reject(new Error(ENGINE_MESSAGES.sqliteLockedOnCommit))
        : Promise.resolve('written');
    }, FAST);

    expect(result).toBe('written');
    expect(calls).toBe(3);
  });

  it('gives up after the budget with a non-retryable catalog_busy and the single-writer remedy', async () => {
    let calls = 0;
    const error: unknown = await retryWhileCatalogBusy(() => {
      calls += 1;
      return Promise.reject(new Error(ENGINE_MESSAGES.sqliteLockedOnFlush));
    }, FAST).catch((reason: unknown) => reason);

    expect(calls).toBe(3);
    expect(error).toBeInstanceOf(LakehouseError);
    expect(error).toMatchObject({ code: 'catalog_busy', retryable: false });
    expect((error as LakehouseError).remedy).toContain(
      'restart this process, or use the PostgreSQL catalog',
    );
  });

  it('does not retry any other failure', async () => {
    let calls = 0;
    const error: unknown = await retryWhileCatalogBusy(() => {
      calls += 1;
      return Promise.reject(new Error(ENGINE_MESSAGES.writeConflict));
    }, FAST).catch((reason: unknown) => reason);

    expect(calls).toBe(1);
    expect(error).toMatchObject({ code: 'write_conflict' });
  });
});
