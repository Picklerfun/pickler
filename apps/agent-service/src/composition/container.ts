import { createHash } from "node:crypto";
import { createRuntime } from "@pickler/agent-runtime";
import { readEnv } from "../config/env";

export async function createContainer(env = readEnv()) {
  const runtime = createRuntime(env);
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
