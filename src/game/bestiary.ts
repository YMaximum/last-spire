import { ENEMY_BY_ID, type BestiaryRecords, type EnemyArchetypeId } from '../content/enemies';
export function mergeDiscoveries(a: BestiaryRecords, b: BestiaryRecords): BestiaryRecords {
  const result = structuredClone(a);
  for (const id of Object.keys(b) as EnemyArchetypeId[]) {
    if (!ENEMY_BY_ID[id]) continue;
    const old = result[id] ?? { encountered: 0, defeated: 0 },
      next = b[id]!;
    result[id] = {
      encountered: Math.min(1e12, old.encountered + next.encountered),
      defeated: Math.min(1e12, old.defeated + next.defeated),
    };
  }
  return result;
}
