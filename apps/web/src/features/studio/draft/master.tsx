"use client";
import { DraftSection, type DraftSectionProps } from "./section";

/**
 * Master wallet (canvas 806–833, spec D17): address, AUSD and MON, the allocation, "Move to an
 * agent", "Buy AI credits", and the ledger (`draft.readLedger`). Task 11 draws it.
 */
export function Master(props: DraftSectionProps) {
  void props;
  return <DraftSection section="master" />;
}
