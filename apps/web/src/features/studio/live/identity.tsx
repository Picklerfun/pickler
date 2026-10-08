"use client";
import { Identity as SharedIdentity } from "../shell/identity";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Identity & voice (canvas 573–607, spec L16): the shared Identity with the public agent's words.
 * The avatar is only drawn, the handle is fixed and public, the voice applies from the next post,
 * and its read-only X authorization can be disconnected without unpublishing the agent. A
 * voice saved here is a setup version too, so VERSIONS is read again after it (`useLive`'s
 * `saveSetup`).
 */
export function Identity({ agent, live, canManage }: LiveSectionProps) {
  return (
    <LiveSection section="identity">
      <SharedIdentity
        idPrefix="live"
        agent={agent}
        studio={live}
        canManage={canManage}
        avatarEditable={false}
        handleNote="HANDLE IS FIXED · PUBLIC"
        voiceSub="how every post reads · from the next post"
      />
    </LiveSection>
  );
}
