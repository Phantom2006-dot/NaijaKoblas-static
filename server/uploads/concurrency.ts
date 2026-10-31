export type ReleaseUploadSlot = () => void;

export function createUploadConcurrencyGate(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Upload concurrency limit must be a positive integer.");
  let active = 0;

  return {
    acquire(): ReleaseUploadSlot | null {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      };
    },
    activeCount() {
      return active;
    },
  };
}
