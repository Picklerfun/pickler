"use client";
import { Identity as SharedIdentity } from "../shell/identity";
import { useVersionedStudio } from "./brief";
import { LiveSection, type LiveSectionProps } from "./live-section";

/**
 * Identity & voice (canvas 573–607, spec L16): the shared Identity with the public agent's words.
 * The avatar is only drawn, the handle is fixed and public, the voice applies from the next post,
 * and a connected X account shows no Disconnect, because the server refuses a public agent's. A
 * voice saved here is a setup version too, so VERSIONS is read again after it.
 */
export function Identity({ agent, live, canManage }: LiveSectionProps) {
  const studio = useVersionedStudio(live);
  return (
    <LiveSection section="identity">
      <SharedIdentity
        idPrefix="live"
        agent={agent}
        studio={studio}
        canManage={canManage}
        avatarEditable={false}
        handleNote="HANDLE IS FIXED · PUBLIC"
        voiceSub="how every post reads · from the next post"
        xSub="where it mirrors every call · optional"
        canDisconnectX={false}
        xKeptNote="A public agent keeps its X account."
      />
    </LiveSection>
  );
}
