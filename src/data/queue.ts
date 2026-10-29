/**
 * Per-key serialised write queue.
 *
 * Every write for a given key runs after the previous one for that key has
 * settled, so two quick edits to the same task cannot interleave and land in
 * the wrong order. Different keys run concurrently — there is no global lock.
 *
 * A rejected write never escapes as an unhandled rejection: it is reported to
 * the `onError` handler and the chain continues, because one failed save must
 * not wedge every later save for that task.
 */
export type QueueError = { key: string; error: unknown };

export interface WriteQueueOptions {
  onError?: (e: QueueError) => void;
}

export class WriteQueue {
  readonly #chains = new Map<string, Promise<void>>();
  readonly #onError: ((e: QueueError) => void) | undefined;
  #pending = 0;

  constructor(options: WriteQueueOptions = {}) {
    this.#onError = options.onError;
  }

  /** Writes still queued or in flight. Zero means everything has settled. */
  get pending(): number {
    return this.#pending;
  }

  /**
   * Queue `work` behind anything already queued for `key`. The returned
   * promise resolves when this write settles, and never rejects.
   */
  push(key: string, work: () => Promise<unknown>): Promise<void> {
    this.#pending++;
    const previous = this.#chains.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => work())
      .then(
        () => undefined,
        (error: unknown) => {
          this.#onError?.({ key, error });
        },
      )
      .finally(() => {
        this.#pending--;
        // Drop the chain once it is the last one, so the map cannot grow
        // without bound across a long session.
        if (this.#chains.get(key) === next) this.#chains.delete(key);
      });
    this.#chains.set(key, next);
    return next;
  }

  /** Resolves once every queued write has settled. */
  async drain(): Promise<void> {
    while (this.#chains.size > 0) {
      await Promise.all([...this.#chains.values()]);
    }
  }
}
