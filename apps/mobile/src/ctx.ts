import type { AccountState } from "./account";
import type { AccountActions } from "./hooks/useAccount";
import type { Perpl } from "./hooks/usePerpl";
import type { Treasury } from "./hooks/useTreasury";
import type { AppStore } from "./store";

/** Todo lo que reciben Shell, DevControls y las pantallas. */
export type AppCtx = AppStore & AccountActions & { account: AccountState; treasury: Treasury; perpl: Perpl };
