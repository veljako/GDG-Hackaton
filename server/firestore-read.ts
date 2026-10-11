import { Timestamp } from "firebase-admin/firestore";

// An explicit snapshot time avoids the SDK's lazy transaction-ID promise,
// which is left rejected when the first read of a read-only transaction fails.
export function readOnlySnapshot() {
  return { readOnly: true as const, readTime: Timestamp.now() };
}

export function isDatabaseQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return (
    (value.code === 8 ||
      value.code === "resource-exhausted" ||
      value.code === "RESOURCE_EXHAUSTED") &&
    typeof value.message === "string" &&
    /quota|resource.exhausted/i.test(value.message)
  );
}
