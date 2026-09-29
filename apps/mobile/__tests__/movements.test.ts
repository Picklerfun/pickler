import { splitMovements } from "../src/wallet/movements";
import type { Movement } from "../src/wallet/explorer";

const m = (hash: string, status: Movement["status"]) => ({ hash, status }) as unknown as Movement;

test("Activity keeps complete and reverted rows; Pending keeps what is still confirming (D18)", () => {
  const rows = [m("0x1", "Confirming"), m("0x2", "Complete"), m("0x3", "Reverted"), m("0x4", "Confirming")];
  const { activity, pending } = splitMovements(rows);
  expect(activity.map((r) => r.hash)).toEqual(["0x2", "0x3"]);
  expect(pending.map((r) => r.hash)).toEqual(["0x1", "0x4"]);
  expect(splitMovements([])).toEqual({ activity: [], pending: [] });
});
