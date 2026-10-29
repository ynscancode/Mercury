import { describe, expect, it } from 'vitest';
import { searchTasks, tokenize } from './search';
import { makeTask } from './task';
import type { Category, Task } from './types';

const TZ = 'Asia/Singapore';
const CATS: Category[] = [
  { id: 'work', name: 'Work', color: '#000' },
  { id: 'school', name: 'School', color: '#000' },
];
const t = (p: Partial<Task> & { id: string; title: string }) => makeTask(p);

const TASKS: Task[] = [
  t({
    id: '1',
    title: 'Write IB report',
    categoryId: 'school',
    notes: 'ask Prof Tan',
  }),
  t({ id: '2', title: 'Report expenses', categoryId: 'work' }),
  t({ id: '3', title: 'Quarterly reporting pack', categoryId: 'work' }),
  t({ id: '4', title: 'Book driving lesson', notes: 'report card needed' }),
  t({ id: '5', title: 'Old report', completedAt: 1, progress: 100 }),
  t({ id: '6', title: 'Archived report', archivedAt: 1 }),
  t({ id: '7', title: 'Deleted report', deletedAt: 1 }),
];

const ids = (q: string, scope = {}) =>
  searchTasks(TASKS, q, CATS, TZ, scope).map((x) => x.id);

describe('tokenize', () => {
  it('splits and lowercases', () => {
    expect(tokenize('  IB   Report ')).toEqual(['ib', 'report']);
  });
  it('is empty for blank input', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('searchTasks', () => {
  it('returns nothing for an empty query rather than everything', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('finds matches across title and notes', () => {
    expect(ids('report')).toEqual(['2', '3', '1', '4']);
  });

  it('ranks a title prefix above a mid-title match, and notes last', () => {
    const order = ids('report');
    expect(order.indexOf('2')).toBeLessThan(order.indexOf('1')); // prefix beats mid-title
    expect(order.at(-1)).toBe('4'); // notes-only match ranks last
  });

  it('is case-insensitive', () => {
    expect(ids('REPORT')).toEqual(ids('report'));
  });

  // Typing a second word must narrow, never widen.
  it('requires every token to match', () => {
    expect(ids('ib report')).toEqual(['1']);
    expect(ids('report nonexistent')).toEqual([]);
  });

  it('matches on category name', () => {
    expect(ids('school')).toEqual(['1']);
  });

  it('combines a category token with a title token', () => {
    expect(ids('work report')).toEqual(['2', '3']);
  });

  it('matches a partial word inside a title', () => {
    expect(ids('reporting')).toEqual(['3']);
  });

  // Deletion must feel like deletion.
  it('never returns soft-deleted tasks, even with every scope widened', () => {
    expect(
      ids('deleted', { includeCompleted: true, includeArchived: true }),
    ).toEqual([]);
  });

  it('excludes completed and archived tasks by default', () => {
    expect(ids('report')).not.toContain('5');
    expect(ids('report')).not.toContain('6');
  });

  it('includes completed tasks when asked', () => {
    expect(ids('old report', { includeCompleted: true })).toEqual(['5']);
  });

  it('includes archived tasks when asked', () => {
    expect(ids('archived', { includeArchived: true })).toEqual(['6']);
  });

  it('breaks ties by due date, then by title', () => {
    const tasks = [
      t({ id: 'b', title: 'Essay', due: '2026-03-10' }),
      t({ id: 'a', title: 'Essay', due: '2026-03-05' }),
      t({ id: 'c', title: 'Essay' }),
    ];
    expect(searchTasks(tasks, 'essay', CATS, TZ).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('handles tasks with no category without crashing', () => {
    expect(ids('driving')).toEqual(['4']);
  });
});
