"use client";
import type { ReactElement } from "react";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Wallets (canvas 749–790, spec L20): master, its wallet, the ledger. Task 6 draws it.
 */
export const Wallets: (props: LiveSectionProps) => ReactElement = () => (
  <LiveSection section="master" />
);
