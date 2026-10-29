/**
 * Application store: optimistic local state, serialised persistence, undo.
 *
 * Built on zustand's vanilla store so it has no React dependency and can be
 * driven directly by tests — and, later, reused by anything else that needs
 * the same mutation semantics.
 *
 * Three behaviours here are load-bearing:
 *
 *   * Every mutation updates local state synchronously and queues the write
 *     behind any earlier write for that same task, so edits cannot land out
 *     of order.
 *   * Exactly one timer runs at a time. Starting one stops the others and
 *     logs their elapsed time, and all of the affected tasks are persisted.
 *   * Destructive actions push a snapshot of what they changed, so undo is a
 *     restore rather than an inverse operation. Inverting "complete" means
 *     knowing what the progress used to be; restoring a snapshot does not.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { WriteQueue } from '@/data/queue';
import {
  withCompleted,
  withRestored,
  withSoftDeleted,
  withTimerStarted,
  withTimerStopped,
  withUncompleted,
} from '@/domain/task';
import {
  DEFAULT_SETTINGS,
  type CalEvent,
  type CalendarAccount,
  type Category,
  type Instant,
  type Settings,
  type Task,
} from '@/domain/types';

export interface Persistence {
  saveTask(task: Task): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
}

export interface UndoEntry {
  label: string;
  at: Instant;
  /** The tasks as they were. Undo puts these back exactly. */
  snapshots: Task[];
}

export const UNDO_LIMIT = 20;

export interface AppState {
  tasks: Record<string, Task>;
  categories: Category[];
  settings: Settings;
  events: CalEvent[];
  accounts: CalendarAccount[];
  undoStack: UndoEntry[];
  /** Ids with a write in flight; a server snapshot must not overwrite these. */
  inFlight: Set<string>;
  error: string | null;
}

export interface AppActions {
  setTasks(tasks: readonly Task[]): void;
  setCategories(categories: readonly Category[]): void;
  setSettings(settings: Settings): void;
  setCalendar(
    events: readonly CalEvent[],
    accounts: readonly CalendarAccount[],
  ): void;

  saveTask(task: Task): void;
  patchTask(id: string, patch: Partial<Task>): void;
  completeTask(id: string, now: Instant): void;
  uncompleteTask(id: string): void;
  deleteTask(id: string, now: Instant): void;
  restoreTask(id: string): void;
  startTimer(id: string, now: Instant): void;
  stopTimer(id: string, now: Instant): void;
  saveSettings(settings: Settings): void;

  undo(): void;
  clearError(): void;
}

export type AppStore = StoreApi<AppState & AppActions>;

export function createAppStore(persistence: Persistence): AppStore {
  const queue = new WriteQueue({
    onError: ({ error }) => {
      store.setState({ error: messageFor(error) });
    },
  });

  const store: AppStore = createStore<AppState & AppActions>((set, get) => {
    /** Apply tasks locally, then persist each behind its own chain. */
    function commit(updated: readonly Task[], undoEntry?: UndoEntry): void {
      if (!updated.length) return;
      set((s) => {
        const tasks = { ...s.tasks };
        const inFlight = new Set(s.inFlight);
        for (const t of updated) {
          tasks[t.id] = t;
          inFlight.add(t.id);
        }
        return {
          tasks,
          inFlight,
          undoStack: undoEntry
            ? [...s.undoStack, undoEntry].slice(-UNDO_LIMIT)
            : s.undoStack,
        };
      });
      for (const t of updated) {
        void queue.push(t.id, async () => {
          try {
            await persistence.saveTask(t);
          } finally {
            set((s) => {
              const inFlight = new Set(s.inFlight);
              inFlight.delete(t.id);
              return { inFlight };
            });
          }
        });
      }
    }

    const read = (id: string): Task | undefined => get().tasks[id];

    return {
      tasks: {},
      categories: [],
      settings: { ...DEFAULT_SETTINGS },
      events: [],
      accounts: [],
      undoStack: [],
      inFlight: new Set<string>(),
      error: null,

      setTasks(incoming) {
        // A server snapshot is authoritative except for tasks whose own write
        // is still in flight — otherwise a realtime message that predates the
        // edit would visibly undo what was just typed.
        set((s) => {
          const tasks: Record<string, Task> = {};
          for (const t of incoming) tasks[t.id] = t;
          for (const id of s.inFlight) {
            const local = s.tasks[id];
            if (local) tasks[id] = local;
          }
          return { tasks };
        });
      },

      setCategories(categories) {
        set({ categories: [...categories] });
      },

      setSettings(settings) {
        set({ settings });
      },

      setCalendar(events, accounts) {
        set({ events: [...events], accounts: [...accounts] });
      },

      saveTask(task) {
        commit([task]);
      },

      patchTask(id, patch) {
        const current = read(id);
        if (!current) return;
        commit([{ ...current, ...patch, id: current.id }]);
      },

      completeTask(id, now) {
        const current = read(id);
        if (!current || current.completedAt != null) return;
        commit([withCompleted(current, now)], {
          label: 'Task completed',
          at: now,
          snapshots: [current],
        });
      },

      uncompleteTask(id) {
        const current = read(id);
        if (!current || current.completedAt == null) return;
        commit([withUncompleted(current)]);
      },

      deleteTask(id, now) {
        const current = read(id);
        if (!current || current.deletedAt != null) return;
        commit([withSoftDeleted(current, now)], {
          label: 'Task deleted',
          at: now,
          snapshots: [current],
        });
      },

      restoreTask(id) {
        const current = read(id);
        if (!current || current.deletedAt == null) return;
        commit([withRestored(current)]);
      },

      startTimer(id, now) {
        const current = read(id);
        if (!current || current.timerStart != null) return;
        const running = Object.values(get().tasks).filter(
          (t) => t.timerStart != null && t.id !== id,
        );
        commit(
          [
            ...running.map((t) => withTimerStopped(t, now)),
            withTimerStarted(current, now),
          ],
          running.length
            ? {
                label: 'Timer switched',
                at: now,
                snapshots: [...running, current],
              }
            : undefined,
        );
      },

      stopTimer(id, now) {
        const current = read(id);
        if (!current || current.timerStart == null) return;
        commit([withTimerStopped(current, now)], {
          label: 'Timer stopped',
          at: now,
          snapshots: [current],
        });
      },

      saveSettings(settings) {
        set({ settings });
        void queue.push('settings', () => persistence.saveSettings(settings));
      },

      undo() {
        const stack = get().undoStack;
        const entry = stack[stack.length - 1];
        if (!entry) return;
        set({ undoStack: stack.slice(0, -1) });
        commit(entry.snapshots);
      },

      clearError() {
        set({ error: null });
      },
    };
  });

  // Exposed for tests and for a "saving…" indicator later.
  (store as AppStore & { queue: WriteQueue }).queue = queue;
  return store;
}

function messageFor(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'quota_exceeded' || code === '53100') {
    return 'Storage is full. Delete some completed tasks to save new ones.';
  }
  return "Couldn't save that change. Check your connection and try again.";
}
