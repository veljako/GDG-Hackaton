import { expect, it } from "vitest";
import { migrateStorageKey } from "./storage";

function storage(values: Record<string, string>) {
  const map = new Map(Object.entries(values));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
it("preserves a saved preference when migrating its browser key", () => {
  const store = storage({ "old-theme": "dark" });
  expect(migrateStorageKey(store, "new-theme", "old-theme")).toBe("dark");
  expect(store.getItem("new-theme")).toBe("dark");
  expect(store.getItem("old-theme")).toBeNull();
});
it("keeps a newer saved value when both names exist", () => {
  const store = storage({ "old-theme": "dark", "new-theme": "light" });
  expect(migrateStorageKey(store, "new-theme", "old-theme")).toBe("light");
});
it("retains legacy data if writing the migrated key is unavailable", () => {
  const store = storage({ "old-theme": "dark" });
  store.setItem = () => {
    throw Error("Storage full");
  };
  expect(migrateStorageKey(store, "new-theme", "old-theme")).toBe("dark");
  expect(store.getItem("old-theme")).toBe("dark");
});
