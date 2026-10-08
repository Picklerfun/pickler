/** Attempt every cleanup in order, without letting one rejection strand later resources. */
export async function closeProfileResources(
  resources: readonly (() => void | Promise<void>)[],
): Promise<number[]> {
  const failed: number[] = [];
  for (const [index, close] of resources.entries()) {
    try {
      await close();
    } catch {
      failed.push(index);
    }
  }
  return failed;
}
