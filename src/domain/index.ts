/**
 * The rules engine.
 *
 * Pure TypeScript with no imports from React, Supabase or the clock: every
 * function that needs the current time is given it. That is what lets the same
 * code run in the browser and inside a scheduled Edge Function, so the server
 * and the UI can never disagree about whether a task is urgent.
 */
export * from './types';
export * from './zone';
export * from './format';
export * from './task';
export * from './capacity';
export * from './priority';
export * from './capture';
export * from './load';
export * from './metrics';
