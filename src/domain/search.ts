/**
 * Search across titles, notes and category names.
 *
 * Every token must match somewhere (AND), because narrowing is the point —
 * typing a second word should shorten the list, not lengthen it. Where a token
 * matches decides the rank: a title beats a category, which beats notes.
 *
 * Soft-deleted tasks are never returned. They live in Trash, and a search that
 * surfaced deleted work would make deletion feel like it had not happened.
 */
import { dueAt } from './task';
import type { Category, Task } from './types';

export interface SearchScope {
  includeCompleted?: boolean;
  includeArchived?: boolean;
}

const TITLE_PREFIX = 100;
const TITLE_WORD = 60;
const TITLE_PART = 40;
const CATEGORY = 20;
const NOTES = 10;

export function searchTasks(
  tasks: readonly Task[],
  query: string,
  categories: readonly Category[],
  tz: string,
  scope: SearchScope = {},
): Task[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const categoryName = new Map(
    categories.map((c) => [c.id, c.name.toLowerCase()]),
  );
  const hits: Array<{ task: Task; score: number }> = [];

  for (const task of tasks) {
    if (task.deletedAt != null) continue;
    if (!scope.includeCompleted && task.completedAt != null) continue;
    if (!scope.includeArchived && task.archivedAt != null) continue;

    const title = task.title.toLowerCase();
    const notes = task.notes.toLowerCase();
    const cat = task.categoryId
      ? (categoryName.get(task.categoryId) ?? '')
      : '';

    let score = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const s = scoreToken(token, title, notes, cat);
      if (s === 0) {
        matchedAll = false;
        break;
      }
      score += s;
    }
    if (matchedAll) hits.push({ task, score });
  }

  return hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        (dueAt(a.task, tz) ?? Infinity) - (dueAt(b.task, tz) ?? Infinity) ||
        a.task.title.localeCompare(b.task.title),
    )
    .map((h) => h.task);
}

function scoreToken(
  token: string,
  title: string,
  notes: string,
  cat: string,
): number {
  if (title.startsWith(token)) return TITLE_PREFIX;
  if (wordStart(title, token)) return TITLE_WORD;
  if (title.includes(token)) return TITLE_PART;
  if (cat.includes(token)) return CATEGORY;
  if (notes.includes(token)) return NOTES;
  return 0;
}

/** True when the token begins a word, which reads as a better match. */
function wordStart(haystack: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(token, from);
    if (i < 0) return false;
    if (i === 0 || /[\s\-_/(),.]/.test(haystack[i - 1]!)) return true;
    from = i + 1;
  }
}

export function tokenize(query: string): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
