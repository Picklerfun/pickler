/** An overrun schedules the next observation immediately, never waits through a second minute. */
export function nextPriceCycleDelay(at: number, startedMinute: number) {
  return Math.floor(at / 60000) > startedMinute ? 1 : Math.max(1, 60000 - (at % 60000) + 100);
}
