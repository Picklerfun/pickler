export interface PtsReportProgress {
  lastRoundSlot: number;
  lastAttemptedSlot?: number | undefined;
  processState: string;
}

/** Publish attempted omissions and state transitions even without a completed round. */
export function createPtsReportTrigger(initial: PtsReportProgress, request: () => void) {
  let previous = { ...initial };

  return {
    update(current: PtsReportProgress, force = false) {
      const changed =
        current.lastRoundSlot !== previous.lastRoundSlot ||
        (current.lastAttemptedSlot ?? -1) !== (previous.lastAttemptedSlot ?? -1) ||
        current.processState !== previous.processState;

      if (!force && !changed) {
        return false;
      }

      previous = { ...current };
      request();
      return true;
    },
  };
}
