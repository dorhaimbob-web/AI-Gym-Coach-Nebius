import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { callFn, ApiError } from './api';

/**
 * GYM-29: offline-first queue for the one interaction that must never
 * block on network — logging a set. Writes land here first, then sync.
 * The server upsert makes replays harmless (last write wins).
 */

export interface QueuedSet {
  sessionId: string;
  exerciseId: string;
  setNo: number;
  weightKg: number;
  reps: number;
  note?: string;
}

const KEY = 'gymcoach.log-queue.v1';
let flushing = false;

async function read(): Promise<QueuedSet[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    return [];
  }
}

async function write(items: QueuedSet[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

/** Queue a set locally, then try to sync immediately. */
export async function enqueueSet(item: QueuedSet): Promise<void> {
  const items = await read();
  // Replace an earlier unsynced write for the same set (corrections).
  const rest = items.filter(
    (i) =>
      !(
        i.sessionId === item.sessionId &&
        i.exerciseId === item.exerciseId &&
        i.setNo === item.setNo
      ),
  );
  await write([...rest, item]);
  void flush();
}

/** Push everything queued; keep items on network failure, drop on 4xx. */
export async function flush(): Promise<{ pending: number }> {
  if (flushing) return { pending: (await read()).length };
  flushing = true;
  try {
    let items = await read();
    for (const item of [...items]) {
      try {
        await callFn('session-log-set', item);
        items = items.filter((i) => i !== item);
        await write(items);
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          // Session gone / invalid — retrying forever won't help.
          items = items.filter((i) => i !== item);
          await write(items);
        } else {
          break; // offline or server trouble — try again later
        }
      }
    }
    return { pending: items.length };
  } finally {
    flushing = false;
  }
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

// Sync whenever connectivity returns.
NetInfo.addEventListener((state) => {
  if (state.isConnected) void flush();
});
