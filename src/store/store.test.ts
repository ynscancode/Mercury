import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAppStore,
  UNDO_LIMIT,
  type AppStore,
  type Persistence,
} from './store';
import { WriteQueue } from '@/data/queue';
import { makeTask } from '@/domain/task';
import { DEFAULT_SETTINGS, type Task } from '@/domain/types';

const NOW = Date.UTC(2026, 2, 5, 9, 0);
const LATER = NOW + 30 * 60_000;

function harness(initial: Task[] = []) {
  const saved: Task[] = [];
  const persistence: Persistence = {
    saveTask: vi.fn(async (t: Task) => void saved.push(t)),
    saveSettings: vi.fn(async () => {}),
  };
  const store = createAppStore(persistence);
  store.getState().setTasks(initial);
  const queue = (store as AppStore & { queue: WriteQueue }).queue;
  return { store, persistence, saved, queue, s: () => store.getState() };
}

const task = (p: Partial<Task> & { id: string }) =>
  makeTask({ title: 'Task', ...p });

describe('store — basics', () => {
  it('starts empty with default settings', () => {
    const { s } = harness();
    expect(s().tasks).toEqual({});
    expect(s().settings).toEqual(DEFAULT_SETTINGS);
    expect(s().undoStack).toEqual([]);
  });

  it('replaces tasks from a server snapshot', () => {
    const { s } = harness([task({ id: 'a' })]);
    s().setTasks([task({ id: 'b' })]);
    expect(Object.keys(s().tasks)).toEqual(['b']);
  });
});

describe('store — optimistic writes', () => {
  it('updates local state before persistence resolves', () => {
    const { s, saved } = harness([task({ id: 'a', title: 'Old' })]);
    s().patchTask('a', { title: 'New' });
    expect(s().tasks.a!.title).toBe('New'); // synchronous
    expect(saved).toHaveLength(0); // not yet written
  });

  it('persists the change', async () => {
    const { s, queue, saved } = harness([task({ id: 'a' })]);
    s().patchTask('a', { title: 'New' });
    await queue.drain();
    expect(saved.at(-1)!.title).toBe('New');
  });

  it('serialises writes for one task', async () => {
    const { s, queue, saved } = harness([task({ id: 'a' })]);
    s().patchTask('a', { title: 'One' });
    s().patchTask('a', { title: 'Two' });
    await queue.drain();
    expect(saved.map((t) => t.title)).toEqual(['One', 'Two']);
  });

  it('ignores a patch for a task it does not have', () => {
    const { s } = harness();
    expect(() => s().patchTask('missing', { title: 'x' })).not.toThrow();
    expect(s().tasks).toEqual({});
  });

  // A realtime message that predates the edit must not visibly undo it.
  it('does not let a server snapshot clobber a write still in flight', async () => {
    const { s, queue } = harness([task({ id: 'a', title: 'Old' })]);
    s().patchTask('a', { title: 'New' });
    s().setTasks([task({ id: 'a', title: 'Old' })]); // stale snapshot arrives
    expect(s().tasks.a!.title).toBe('New');
    await queue.drain();
    // Once settled, the server is authoritative again.
    s().setTasks([task({ id: 'a', title: 'Server' })]);
    expect(s().tasks.a!.title).toBe('Server');
  });

  it('surfaces a persistence failure as a readable message', async () => {
    const persistence: Persistence = {
      saveTask: vi.fn(async () => {
        throw new Error('network down');
      }),
      saveSettings: vi.fn(async () => {}),
    };
    const store = createAppStore(persistence);
    store.getState().setTasks([task({ id: 'a' })]);
    store.getState().patchTask('a', { title: 'New' });
    await (store as AppStore & { queue: WriteQueue }).queue.drain();
    expect(store.getState().error).toContain("Couldn't save");
    store.getState().clearError();
    expect(store.getState().error).toBeNull();
  });
});

describe('store — completion', () => {
  it('completes a task and records the previous progress', () => {
    const { s } = harness([task({ id: 'a', progress: 60, estMin: 120 })]);
    s().completeTask('a', NOW);
    const t = s().tasks.a!;
    expect(t.completedAt).toBe(NOW);
    expect(t.progress).toBe(100);
    expect(t.progressBefore).toBe(60);
    expect(t.actualStart).toBe(NOW); // backfilled so elapsed time is real
  });

  it('un-completing restores the progress it had', () => {
    const { s } = harness([task({ id: 'a', progress: 60 })]);
    s().completeTask('a', NOW);
    s().uncompleteTask('a');
    expect(s().tasks.a!.progress).toBe(60);
    expect(s().tasks.a!.completedAt).toBeNull();
  });

  it('folds a running timer into the log when completing', () => {
    const { s } = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW, loggedMin: 5 }),
    ]);
    s().completeTask('a', LATER);
    expect(s().tasks.a!.loggedMin).toBe(35);
    expect(s().tasks.a!.timerStart).toBeNull();
  });

  it('ignores completing an already-completed task', () => {
    const { s } = harness([task({ id: 'a', completedAt: NOW, progress: 100 })]);
    s().completeTask('a', LATER);
    expect(s().tasks.a!.completedAt).toBe(NOW);
  });
});

describe('store — soft delete', () => {
  it('marks a task deleted rather than removing it', () => {
    const { s } = harness([task({ id: 'a' })]);
    s().deleteTask('a', NOW);
    expect(s().tasks.a).toBeDefined();
    expect(s().tasks.a!.deletedAt).toBe(NOW);
  });

  it('restores a deleted task', () => {
    const { s } = harness([task({ id: 'a' })]);
    s().deleteTask('a', NOW);
    s().restoreTask('a');
    expect(s().tasks.a!.deletedAt).toBeNull();
  });

  it('persists the deletion', async () => {
    const { s, queue, saved } = harness([task({ id: 'a' })]);
    s().deleteTask('a', NOW);
    await queue.drain();
    expect(saved.at(-1)!.deletedAt).toBe(NOW);
  });
});

describe('store — the single-timer rule', () => {
  it('starts a timer and backfills the start', () => {
    const { s } = harness([task({ id: 'a' })]);
    s().startTimer('a', NOW);
    expect(s().tasks.a!.timerStart).toBe(NOW);
    expect(s().tasks.a!.actualStart).toBe(NOW);
  });

  it('stops any other running timer and logs its time', () => {
    const { s } = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW }),
      task({ id: 'b' }),
    ]);
    s().startTimer('b', LATER);
    expect(s().tasks.a!.timerStart).toBeNull();
    expect(s().tasks.a!.loggedMin).toBe(30);
    expect(s().tasks.b!.timerStart).toBe(LATER);
  });

  // Both tasks changed, so both must reach the server.
  it('persists every task the switch touched', async () => {
    const { s, queue, saved } = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW }),
      task({ id: 'b' }),
    ]);
    s().startTimer('b', LATER);
    await queue.drain();
    expect(saved.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('stopping logs the elapsed time', () => {
    const { s } = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW, loggedMin: 10 }),
    ]);
    s().stopTimer('a', LATER);
    expect(s().tasks.a!.loggedMin).toBe(40);
    expect(s().tasks.a!.timerStart).toBeNull();
  });

  it('ignores starting a timer that is already running', () => {
    const { s } = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW }),
    ]);
    s().startTimer('a', LATER);
    expect(s().tasks.a!.timerStart).toBe(NOW);
  });
});

describe('store — undo', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness([task({ id: 'a', title: 'Essay', progress: 40, estMin: 120 })]);
  });

  it('undoes a deletion', () => {
    h.s().deleteTask('a', NOW);
    h.s().undo();
    expect(h.s().tasks.a!.deletedAt).toBeNull();
  });

  // Inverting "complete" would mean guessing the old progress; restoring a
  // snapshot does not have to.
  it('undoes a completion back to the exact previous progress', () => {
    h.s().completeTask('a', NOW);
    h.s().undo();
    expect(h.s().tasks.a!).toMatchObject({ completedAt: null, progress: 40 });
  });

  it('undoes a timer stop, putting the clock back', () => {
    const h2 = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW, loggedMin: 5 }),
    ]);
    h2.s().stopTimer('a', LATER);
    h2.s().undo();
    expect(h2.s().tasks.a!.timerStart).toBe(NOW);
    expect(h2.s().tasks.a!.loggedMin).toBe(5);
  });

  it('undoes a timer switch, restoring both tasks', () => {
    const h2 = harness([
      task({ id: 'a', actualStart: NOW, timerStart: NOW }),
      task({ id: 'b' }),
    ]);
    h2.s().startTimer('b', LATER);
    h2.s().undo();
    expect(h2.s().tasks.a!.timerStart).toBe(NOW);
    expect(h2.s().tasks.b!.timerStart).toBeNull();
  });

  it('persists the restoration', async () => {
    h.s().deleteTask('a', NOW);
    h.s().undo();
    await h.queue.drain();
    expect(h.saved.at(-1)!.deletedAt).toBeNull();
  });

  it('pops entries so a second undo does not repeat the first', () => {
    h.s().deleteTask('a', NOW);
    expect(h.s().undoStack).toHaveLength(1);
    h.s().undo();
    expect(h.s().undoStack).toHaveLength(0);
    expect(() => h.s().undo()).not.toThrow();
  });

  it('does nothing when there is nothing to undo', () => {
    expect(() => h.s().undo()).not.toThrow();
  });

  // An ordinary edit is not destructive, so it does not join the stack.
  it('does not record plain edits', () => {
    h.s().patchTask('a', { title: 'Changed' });
    expect(h.s().undoStack).toHaveLength(0);
  });

  it('caps the stack so a long session cannot grow it without bound', () => {
    const many = harness(
      Array.from({ length: UNDO_LIMIT + 5 }, (_, i) => task({ id: `t${i}` })),
    );
    for (let i = 0; i < UNDO_LIMIT + 5; i++) many.s().deleteTask(`t${i}`, NOW);
    expect(many.s().undoStack).toHaveLength(UNDO_LIMIT);
  });
});

describe('store — settings', () => {
  it('applies and persists settings', async () => {
    const { s, queue, persistence } = harness();
    const next = { ...DEFAULT_SETTINGS, buffer: 2 };
    s().saveSettings(next);
    expect(s().settings.buffer).toBe(2);
    await queue.drain();
    expect(persistence.saveSettings).toHaveBeenCalledWith(next);
  });
});
