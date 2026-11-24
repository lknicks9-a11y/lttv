/**
 * Remote presses first. Background work (finding each game's streams, the guide index, loading your channels)
 * runs in short slices; between slices it gives the TV back to the remote — and while you're pressing buttons
 * it waits until you pause, so a press is never stuck in line behind it.
 */
let lastInput = -1e9;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The remote (or keyboard / mouse) was just used. */
export function noteInput(): void {
  lastInput = now();
}

/** Milliseconds since the remote was last used. */
export function sinceInput(): number {
  return now() - lastInput;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A break for the remote: always lets waiting presses through; while you're moving, waits until you pause (≤ 2 s). */
export async function yieldToInput(): Promise<void> {
  await tick();
  const start = now();
  while (sinceInput() < 220 && now() - start < 2000) await new Promise<void>((r) => setTimeout(r, 50));
}

/** True when ~8 ms of work has gone by since the last break (call it in loops: `if (due()) await yieldToInput()`). */
export function slicer(budgetMs = 8): () => boolean {
  let t = now();
  return () => {
    if (now() - t < budgetMs) return false;
    t = now();
    return true;
  };
}
