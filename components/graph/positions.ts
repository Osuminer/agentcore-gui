export type Positions = Record<string, { x: number; y: number }>;
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const keyFor = (root: string) => `agentcore-gui:positions:${root}`;

/** Browser storage if available; access itself can throw (blocked site data, private windows). */
function defaultStorage(): StorageLike | undefined {
  try { return (globalThis as { localStorage?: StorageLike }).localStorage; } catch { return undefined; }
}

/** Auto-layout positions, with user-moved positions layered on top for nodes that still exist. */
export function mergePositions(auto: Positions, overrides: Positions): Positions {
  const out: Positions = {};
  for (const [id, p] of Object.entries(auto)) out[id] = overrides[id] ?? p;
  return out;
}

export function loadPositions(root: string, storage: StorageLike | undefined = defaultStorage()): Positions {
  try {
    const raw = storage?.getItem(keyFor(root));
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
    const out: Positions = {};
    for (const [id, p] of Object.entries(data as Record<string, unknown>)) {
      const q = p as { x?: unknown; y?: unknown } | null;
      if (q && typeof q === 'object' && typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y)) {
        out[id] = { x: q.x, y: q.y };
      }
    }
    return out;
  } catch { return {}; }
}

/** Saves moved positions for a project; an empty map removes the entry (reset layout). Never throws. */
export function savePositions(root: string, positions: Positions, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    if (!storage) return;
    if (Object.keys(positions).length === 0) storage.removeItem(keyFor(root));
    else storage.setItem(keyFor(root), JSON.stringify(positions));
  } catch { /* storage unavailable: positions last for this session only */ }
}
