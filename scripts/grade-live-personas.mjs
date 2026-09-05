import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractClaims,
  gradeSchema,
  gradingInstructions,
  validateGrade,
} from "../evaluation/live-personas/grading.mjs";
import { digest, preserveJson, readJson, saveJson } from "../evaluation/live-personas/storage.mjs";

process.umask(0o077);
const root = resolve(process.env.LIVE_RUN_DIR ?? ".artifacts/live-evaluation/20260905-personas-01");
const dataset = readJson(`${root}/dataset.json`);
if (digest(dataset) !== readJson(`${root}/dataset-manifest.json`).sha256) throw new Error("Frozen dataset mismatch");
const secondPass = process.env.LIVE_GRADING_PASS === "second";
const folder = `${root}/${secondPass ? "grading-second-pass" : "grading-v2"}`;
const instructions = secondPass
  ? `${gradingInstructions}\nこれは別評価パスです。初回採点は参照しません。否定のある属性名とnegativeの二重否定を確認し、「家族設定を消す読み方を否定」は「家族を消さない」と整合する点に注意。「本人」が誰を指すかを文脈で読む。入力が空欄でも、関係の発展を楽しむ文章はnarrative_interestを支持し得る。情報不足で具体化を保留する例を減点しない。`
  : gradingInstructions;
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8")).vars;
process.loadEnvFile(".dev.vars");
const env = { ...config, ...process.env };
if (env.LLM_PROVIDER !== "openai") throw new Error("OpenAI required for grading assistance");
const endpoint = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(env.AI_GATEWAY_ACCOUNT_ID)}/${encodeURIComponent(env.AI_GATEWAY_GATEWAY_ID)}/openai/responses`;
preserveJson(`${folder}/method.json`, {
  method:
    "OpenAI structured grading assistance, followed by Codex review. Not human-validated. Grading API calls are separate from measured app calls.",
  instructions,
  promptHash: digest(instructions),
  requestedModel: env.LLM_MODEL,
  effort: env.LLM_REASONING_EFFORT || null,
  sources: "Frozen verified source notes; no additional model knowledge accepted as source evidence",
});
const sample = secondPass ? readJson(`${root}/second-pass-selection.json`).cases.map((c) => c.caseId) : null;
const selected = dataset.cases.filter(
  (c) =>
    (!sample || sample.includes(c.id)) && (!process.env.LIVE_CASES || process.env.LIVE_CASES.split(",").includes(c.id)),
);
for (const c of selected) {
  if (readJson(`${folder}/${c.id}.json`, null)) continue;
  const raw = readJson(`${root}/cases/${c.id}/preference-before.json`, null);
  if (!raw) continue;
  const claims = extractClaims(raw);
  const material = {
    caseId: c.id,
    input: c.input,
    gold: c.gold,
    rubric: dataset.rubric,
    sources: Object.fromEntries(c.research.sourceIds.map((id) => [id, dataset.sources[id]])),
    claims,
    limitations: raw.preferenceAnalysis?.summary.limitations,
    uncertainties: raw.preferenceAnalysis?.uncertainties,
  };
  preserveJson(`${folder}/inputs/${c.id}.json`, material);
  console.log("grading", c.id, claims.length, "claims");
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let observation = readJson(`${folder}/raw/${c.id}-${attempt}.json`, null);
    if (!observation) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": digest(`${digest(material)}-${digest(instructions)}-${attempt}`),
          "cf-aig-skip-cache": "true",
          "cf-aig-collect-log-payload": "false",
          "cf-aig-request-timeout": "600000",
        },
        body: JSON.stringify({
          model: env.LLM_MODEL,
          ...(env.LLM_REASONING_EFFORT ? { reasoning: { effort: env.LLM_REASONING_EFFORT } } : {}),
          store: false,
          max_output_tokens: 30000,
          input: [
            { role: "system", content: instructions },
            { role: "user", content: JSON.stringify(material) },
          ],
          text: { format: { type: "json_schema", name: "persona_grade", strict: true, schema: gradeSchema } },
        }),
        signal: AbortSignal.timeout(600000),
      });
      observation = { httpStatus: response.status, elapsedMs: Date.now() - started, response: await response.json() };
      preserveJson(`${folder}/raw/${c.id}-${attempt}.json`, observation);
    }
    const body = observation.response;
    if (observation.httpStatus >= 400) throw new Error(`GRADER_HTTP_${observation.httpStatus}`);
    try {
      const content = body.output
        .flatMap((x) => x.content ?? [])
        .filter((x) => x.type === "output_text")
        .map((x) => x.text)
        .join("");
      const grade = validateGrade(JSON.parse(content), c, claims);
      saveJson(`${folder}/${c.id}.json`, {
        ...grade,
        claims: grade.claims.map((g) => ({ ...claims.find((x) => x.id === g.id), ...g })),
        metadata: {
          requestedModel: env.LLM_MODEL,
          responseModel: body.model,
          effort: env.LLM_REASONING_EFFORT || null,
          usage: body.usage,
          elapsedMs: observation.elapsedMs,
          promptHash: digest(instructions),
          materialHash: digest(material),
          codexReviewed: false,
        },
      });
      console.log("graded", c.id);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      console.log("retry grade format", c.id);
    }
  }
}
