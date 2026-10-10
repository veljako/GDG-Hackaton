type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function migrateStorageKey(
  storage: BrowserStorage,
  key: string,
  legacyKey: string,
): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  const legacy = storage.getItem(legacyKey);
  if (legacy === null) return null;
  try {
    storage.setItem(key, legacy);
    storage.removeItem(legacyKey);
  } catch {
    // Preserve the previous value when browser storage cannot accept a write.
  }
  return legacy;
}
