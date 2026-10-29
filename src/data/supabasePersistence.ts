/**
 * The Supabase implementation of the store's persistence port.
 *
 * Deliberately thin: every decision about shape lives in the mappers, which
 * are tested, and every decision about ordering lives in the store's queue.
 * This file only talks to the network.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Settings, Task } from '@/domain/types';
import type { Persistence } from '@/store/store';
import { settingsToRow, taskToRow } from './mappers';

export function createSupabasePersistence(
  client: SupabaseClient,
  userId: string,
): Persistence {
  return {
    async saveTask(task: Task) {
      const { error } = await client
        .from('tasks')
        .upsert(taskToRow(task, userId));
      if (error) throw error;
    },
    async saveSettings(settings: Settings) {
      const { error } = await client
        .from('settings')
        .upsert(settingsToRow(settings, userId));
      if (error) throw error;
    },
  };
}
