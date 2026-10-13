import { describe, expect, it } from 'vitest';
import { loadPositions, mergePositions, savePositions, type Positions, type StorageLike } from '@/components/graph/positions';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}
const throwing: StorageLike = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('mergePositions', () => {
  const auto: Positions = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } };
  it('uses the override for moved nodes and the auto position for the rest', () => {
    expect(mergePositions(auto, { b: { x: 99, y: 98 } })).toEqual({ a: { x: 0, y: 0 }, b: { x: 99, y: 98 } });
  });
  it('ignores overrides for nodes that no longer exist', () => {
    expect(Object.keys(mergePositions(auto, { ghost: { x: 1, y: 1 } })).sort()).toEqual(['a', 'b']);
  });
  it('does not mutate its inputs', () => {
    const o: Positions = { a: { x: 5, y: 5 } };
    mergePositions(auto, o);
    expect(auto.a).toEqual({ x: 0, y: 0 });
    expect(o).toEqual({ a: { x: 5, y: 5 } });
  });
});

describe('save/load positions', () => {
  it('round-trips per project root', () => {
    const s = memoryStorage();
    savePositions('/p1', { a: { x: 1, y: 2 } }, s);
    savePositions('/p2', { a: { x: 9, y: 9 } }, s);
    expect(loadPositions('/p1', s)).toEqual({ a: { x: 1, y: 2 } });
    expect(loadPositions('/p2', s)).toEqual({ a: { x: 9, y: 9 } });
  });
  it('returns an empty map when nothing is stored', () => {
    expect(loadPositions('/none', memoryStorage())).toEqual({});
  });
  it('recovers from corrupt JSON', () => {
    expect(loadPositions('/p', memoryStorage({ 'agentcore-gui:positions:/p': '{{{' }))).toEqual({});
  });
  it('drops malformed entries (non-finite or non-numeric coordinates)', () => {
    const raw = JSON.stringify({ ok: { x: 1, y: 2 }, bad1: { x: 'a', y: 1 }, bad2: { x: null, y: 1 }, bad3: 5, bad4: { x: 1 }, bad5: { x: 1e999, y: 1 } });
    expect(loadPositions('/p', memoryStorage({ 'agentcore-gui:positions:/p': raw }))).toEqual({ ok: { x: 1, y: 2 } });
  });
  it('ignores a stored value that is not an object', () => {
    expect(loadPositions('/p', memoryStorage({ 'agentcore-gui:positions:/p': '[1,2]' }))).toEqual({});
  });
  it('removes the entry when saving an empty map (reset layout)', () => {
    const s = memoryStorage();
    savePositions('/p', { a: { x: 1, y: 1 } }, s);
    savePositions('/p', {}, s);
    expect(Object.keys(s.data)).toEqual([]);
  });
  it('never throws when storage is unavailable', () => {
    expect(() => savePositions('/p', { a: { x: 1, y: 1 } }, throwing)).not.toThrow();
    expect(loadPositions('/p', throwing)).toEqual({});
    expect(loadPositions('/p', undefined)).toEqual({});
  });
});
