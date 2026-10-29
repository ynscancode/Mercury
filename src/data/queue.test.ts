import { describe, expect, it, vi } from 'vitest';
import { WriteQueue } from './queue';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('WriteQueue', () => {
  it('runs writes for one key strictly in order', async () => {
    const q = new WriteQueue();
    const order: number[] = [];
    // The first write is the slowest, so without serialisation it would finish last.
    q.push('a', async () => {
      await tick(30);
      order.push(1);
    });
    q.push('a', async () => {
      await tick(10);
      order.push(2);
    });
    q.push('a', async () => {
      order.push(3);
    });
    await q.drain();
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not serialise across different keys', async () => {
    const q = new WriteQueue();
    const order: string[] = [];
    q.push('slow', async () => {
      await tick(30);
      order.push('slow');
    });
    q.push('fast', async () => {
      order.push('fast');
    });
    await q.drain();
    expect(order).toEqual(['fast', 'slow']);
  });

  // One failed save must not wedge every later save for that task.
  it('keeps the chain alive after a failure', async () => {
    const onError = vi.fn();
    const q = new WriteQueue({ onError });
    const order: string[] = [];
    q.push('a', async () => {
      throw new Error('offline');
    });
    q.push('a', async () => {
      order.push('after');
    });
    await q.drain();
    expect(order).toEqual(['after']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ key: 'a' });
  });

  it('never rejects, so a caller cannot produce an unhandled rejection', async () => {
    const q = new WriteQueue();
    await expect(
      q.push('a', async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
  });

  it('tracks how many writes are outstanding', async () => {
    const q = new WriteQueue();
    expect(q.pending).toBe(0);
    q.push('a', () => tick(10));
    q.push('b', () => tick(10));
    expect(q.pending).toBe(2);
    await q.drain();
    expect(q.pending).toBe(0);
  });

  it('releases finished chains so the map cannot grow forever', async () => {
    const q = new WriteQueue();
    for (let i = 0; i < 50; i++) q.push(`key-${i}`, async () => {});
    await q.drain();
    expect(q.pending).toBe(0);
  });

  it('drains writes queued while draining', async () => {
    const q = new WriteQueue();
    let done = false;
    q.push('a', async () => {
      await tick(5);
      q.push('b', async () => {
        await tick(5);
        done = true;
      });
    });
    await q.drain();
    expect(done).toBe(true);
  });
});
