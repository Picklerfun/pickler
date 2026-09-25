import {
  ACCENTS,
  BEATS,
  STYLES,
  SUGGESTED_SKILLS,
  VENUES_ON_MAP,
  type AgentDraft,
  type AgentDrafter,
} from "@pickler/core";

/** The model could not produce a draft. Never replaced by a guess; the API answers 503. */
export class DraftUnavailableError extends Error {
  readonly code = "DRAFT_UNAVAILABLE";

  constructor(cause: unknown) {
    super("The model could not draft this agent", { cause });
    this.name = "DraftUnavailableError";
  }
}

export interface OpenAiCompatibleDrafterConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  fetch?: typeof fetch;
  /** Checks the model's JSON against the public draft contract; the worker injects the schema. */
  validate: (raw: unknown) => AgentDraft;
}

const DASHSCOPE_HOSTS = ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"];

function systemPrompt(): string {
  const beats = BEATS.map(
    (beat) => `  - ${beat.name}: ${beat.subs.map((sub) => sub.label).join(", ")}`,
  ).join("\n");
  const skills = Object.values(SUGGESTED_SKILLS)
    .flat()
    .map((skill) => `"${skill.name}"`)
    .join(", ");
  return [
    "You turn one sentence describing a prediction-market research agent into a JSON object.",
    "Answer with exactly these keys and nothing else:",
    "- name: a short display name, at most 40 characters.",
    "- handle: 3 to 15 characters, lowercase letters, digits and underscores only.",
    `- venues: a non-empty array drawn from ${VENUES_ON_MAP.map((v) => `"${v}"`).join(", ")}.`,
    "- beat: exactly one of the beats below.",
    "- subcategories: labels from the chosen beat only, copied exactly:",
    beats,
    "- sites: up to 6 bare hostnames the agent should read first, such as espn.com.",
    `- skills: names copied exactly from ${skills}; only ones that fit, possibly none.`,
    "- edge: one sentence, at most 400 characters, rewriting the line as what the agent looks for.",
    `- style: one of ${STYLES.map((s) => `"${s}"`).join(", ")}.`,
    `- accent: one of ${ACCENTS.map((a) => `"${a}"`).join(", ")}.`,
    "Use the beat the sentence is about even when it is not Sports.",
  ].join("\n");
}

function contentOf(body: unknown): string {
  const choices = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("The model returned no content");
  }
  return content;
}

/** Drafts with the same OpenAI-compatible endpoint the research runtime uses. */
export function createOpenAiCompatibleDrafter(config: OpenAiCompatibleDrafterConfig): AgentDrafter {
  const request = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  // DashScope's hybrid models need thinking off for a single structured answer, as in the runtime.
  const dashScope = DASHSCOPE_HOSTS.includes(new URL(base).hostname);
  const prompt = systemPrompt();

  return {
    async draft(line) {
      try {
        const response = await request(`${base}/chat/completions`, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.modelId,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: prompt },
              { role: "user", content: line },
            ],
            ...(dashScope ? { enable_thinking: false } : {}),
          }),
        });
        if (!response.ok) {
          throw new Error(`The model answered ${response.status}`);
        }
        const content = contentOf(await response.json());
        return config.validate(JSON.parse(content));
      } catch (caught) {
        throw new DraftUnavailableError(caught);
      }
    },
  };
}
