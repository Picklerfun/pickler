import { createHash } from "node:crypto";
import { createRuntime } from "@pickler/agent-runtime";
import { composeTrading } from "./trading";
import { readEnv } from "../config/env";
import { createFileObserver } from "../observation/capture";

export async function createContainer(env = readEnv()) {
  const observer = createFileObserver(env);
  const runtime = createRuntime(env, undefined, observer ? { observer } : undefined);
  try {
    await runtime.repository.init();
    await runtime.repository.bindConnectionIdentity(
      createHash("sha256")
        .update(
          JSON.stringify([env.MODEL_BASE_URL, env.MODEL_ID, env.MODEL_API_KEY, env.EXA_API_KEY]),
        )
        .digest("hex"),
    );
    return {
      ...runtime,
      trading: composeTrading(env, runtime.repository),
      env,
      async checkConnections() {
        await runtime.repository.setConnectionsChecked(false);
        const result = await runtime.checkConnections();
        await runtime.repository.setConnectionsChecked(true);
        return result;
      },
    };
  } catch (error) {
    await runtime.repository.close();
    throw error;
  }
}
export type Container = Awaited<ReturnType<typeof createContainer>>;
