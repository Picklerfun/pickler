import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppState } from "react-native";
import type { AccountState } from "../src/account";
import { useReads, type Reads } from "../src/hooks/useReads";
import type { Notifications } from "../src/hooks/useNotifications";

jest.mock("../src/wallet/wallet",()=>({describeError:()=>"failed"}));
jest.mock("../src/hooks/useUnlock", () => ({ useUnlock: () => async () => {throw new Error("No signing in read test");} }));
jest.mock("../src/storage/reads", () => ({loadReadsSession:jest.fn(),saveReadsSession:jest.fn(),clearReadsSession:jest.fn()}));
jest.mock("../src/reads/api", () => ({fetchAgents:jest.fn(async()=>[]),fetchReads:jest.fn(),describeReadsError:()=>"failed",isSessionError:()=>false}));
const storage=jest.requireMock("../src/storage/reads");
const api=jest.requireMock("../src/reads/api");
const ADDRESS="0x1111111111111111111111111111111111111111" as const;
const account:AccountState={status:"locked",address:ADDRESS,credentialId:"fixture"};
const notifications={ensurePermission:async()=>null,scheduleLocal:async()=>{},scheduleLocalReminders:async()=>{}} as unknown as Notifications;
let current:Reads;
function View({owner=account}:{owner?:AccountState}) {current=useReads(owner,()=>{},notifications,16);return null;}

test("Reads refreshes stay single-flight, abort on background and drop stale owner replies",async()=>{
  jest.useFakeTimers();
  storage.loadReadsSession.mockResolvedValue({address:ADDRESS,ts:Date.now(),sig:`0x${"ab".repeat(65)}`});
  const signals:AbortSignal[]=[];
  const finish:((value:unknown)=>void)[]=[];
  api.fetchReads.mockImplementation((_base:unknown,_session:unknown,_market:unknown,_fetch:unknown,signal:AbortSignal)=>new Promise(resolve=>{signals.push(signal);finish.push(resolve);}));
  let visibility:((state:string)=>void)|undefined;
  const subscribe=jest.spyOn(AppState,"addEventListener").mockImplementation((_type,listener)=>{visibility=listener as (state:string)=>void;return {remove:()=>{}};});
  let tree:ReactTestRenderer;
  await act(async()=>{tree=create(createElement(View));});
  await act(async()=>{current.setActive(true);});
  expect(signals).toHaveLength(1);
  await act(async()=>{void current.refresh();jest.advanceTimersByTime(45000);});
  expect(signals).toHaveLength(1);
  await act(async()=>{visibility?.("background");});
  expect(signals[0].aborted).toBe(true);
  await act(async()=>{finish[0]({reads:[],credits:999});});
  expect(current.credits).toBeNull();
  await act(async()=>{visibility?.("active");});
  expect(signals).toHaveLength(2);
  await act(async()=>{tree.update(createElement(View,{owner:{status:"none"}}));});
  expect(signals[1].aborted).toBe(true);
  await act(async()=>{finish[1]({reads:[],credits:777});});
  expect(current.credits).toBeNull();
  await act(async()=>{tree.unmount();});
  subscribe.mockRestore();
  jest.useRealTimers();
});
