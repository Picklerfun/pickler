"use client";
import type { ReactElement } from "react";
import type { PasskeyDto } from "../../auth/lib/custody-api";
import type { AccountTab } from "./model";
import { LiveSection, type LiveSectionProps } from "./live-section";

export interface AccountProps extends LiveSectionProps {
  /** The tab it opens on (`?stage=perpl-account-profile|notify`); Security otherwise. */
  initialTab: AccountTab;
  /** A stage's passkeys, in place of `GET /v1/signing/passkeys`; null reads them. */
  stagedPasskeys: PasskeyDto[] | null;
}

/**
 * Account (canvas 692–747, spec L21): Security, Public profile and Notifications, reusing the
 * account page's sections. Task 6 draws it.
 */
export const Account: (props: AccountProps) => ReactElement = () => (
  <LiveSection section="account" />
);
