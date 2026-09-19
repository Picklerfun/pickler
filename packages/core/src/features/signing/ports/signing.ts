import type {
  ForwardExpectations,
  SignedActivityRequest,
  TurnkeyActivity,
} from "../domain/turnkey-activity.js";

export interface SignedActivityForwarder {
  /** Forwards a passkey-stamped activity and returns it, briefly polled towards a terminal status. */
  forward(
    request: SignedActivityRequest,
    expectations: ForwardExpectations,
  ): Promise<TurnkeyActivity>;
}

export interface TurnkeyReader {
  getActivity(organizationId: string, activityId: string): Promise<TurnkeyActivity>;
}
