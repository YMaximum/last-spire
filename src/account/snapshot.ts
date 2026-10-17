import { defaultSettings, parseGame, type SaveV3 } from '../v3/storage';

/** Cloud data deliberately excludes device-specific audio, graphics and window settings. */
export type CloudSnapshot = Omit<SaveV3, 'settings'>;
export const MAX_CLOUD_BYTES = 8 * 1024 * 1024;

export function snapshotFromSave(save: SaveV3): CloudSnapshot {
  const { settings: _settings, ...snapshot } = parseGame(save);
  return snapshot;
}

export function validateSnapshot(value: unknown): CloudSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a cloud checkpoint.');
  if (Object.keys(value).some((key) => !['version', 'profile', 'run', 'progression'].includes(key)))
    throw new Error('Unsupported cloud checkpoint fields.');
  // Validate nesting, finite values and plain objects before serializing untrusted input.
  const { settings: _settings, ...snapshot } = parseGame({ ...value, settings: defaultSettings() });
  const encoded = JSON.stringify(snapshot);
  if (new TextEncoder().encode(encoded).length > MAX_CLOUD_BYTES)
    throw new Error('Cloud checkpoint exceeds its size limit.');
  return snapshot;
}

export function saveFromSnapshot(snapshot: unknown, settings: SaveV3['settings']): SaveV3 {
  return parseGame({ ...validateSnapshot(snapshot), settings });
}
