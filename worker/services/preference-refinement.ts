import { HTTPException } from "hono/http-exception";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import type { PreferenceHypothesis, PreferenceRefinement, RefinementContext } from "../../shared/quality-schemas";
import { responseChannelLabel } from "../../shared/response-channels";
import { deriveUuid, nowIso, sha256Hex } from "../lib/crypto";
import { first } from "../lib/db";
import type { Env } from "../types";
import { outboxStatement } from "./orchestration";
import { prepareQuotaReservation } from "./quota";

export async function refinePreferenceInput(
  env: Env,
  ownerUserId: string,
  domain: AnalysisDomain,
  entryId: string,
  input: PreferenceRefinement,
  key: string,
) {
  const id = await deriveUuid(env.AUTH_PEPPER, `refinement:${ownerUserId}:${domain}:${entryId}:${key}`),
    hash = await sha256Hex(JSON.stringify(input));
  const existing = await first<{ request_hash: string }>(
    env.DB.prepare(`SELECT request_hash FROM preference_refinements WHERE id=? AND owner_user_id=?`).bind(
      id,
      ownerUserId,
    ),
  );
  if (existing) {
    if (hash !== existing.request_hash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
    return { id, replayed: true, outboxEventId: null };
  }
  const target = await first<{
    entry_revision_id: string;
    source_set_id: string | null;
    revision_number: number;
    job_id: string;
    analysis_run_id: string;
  }>(
    env.DB.prepare(
      `SELECT er.id AS entry_revision_id,er.source_set_id,er.revision_number,j.id AS job_id,(SELECT ar.id FROM analysis_runs ar WHERE ar.entry_revision_id=er.id AND ar.owner_user_id=e.owner_user_id AND ar.status='succeeded' ORDER BY ar.run_generation DESC LIMIT 1) AS analysis_run_id FROM user_character_entries e JOIN entry_revisions er ON er.entry_id=e.id AND er.revision_number=e.active_revision_number JOIN jobs j ON j.target_type='entry' AND j.target_id=e.id AND j.input_generation=er.revision_number AND j.owner_user_id=e.owner_user_id WHERE e.id=? AND e.owner_user_id=? AND e.analysis_domain=? AND e.status='analysis_review' AND j.status='waiting_for_user'`,
    ).bind(entryId, ownerUserId, domain),
  );
  if (!target?.analysis_run_id) throw new HTTPException(409, { message: "好みの確認画面を再読み込みしてください" });
  const context: RefinementContext = { schemaVersion: "2.1", baseAnalysisRunId: target.analysis_run_id };
  let answers = input.mode === "questions" ? input.answers : [];
  if (input.mode === "selection") {
    const batch = await first<{ id: string; context_json: string; hypotheses_json: string | null }>(
      env.DB.prepare(
        `SELECT id,context_json,hypotheses_json FROM preference_refinements WHERE owner_user_id=? AND entry_revision_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`,
      ).bind(ownerUserId, target.entry_revision_id),
    );
    if (
      !batch?.hypotheses_json ||
      batch.id !== input.hypothesisBatchId ||
      JSON.parse(batch.context_json).baseAnalysisRunId !== target.analysis_run_id
    )
      throw new HTTPException(409, { message: "仮説候補が更新されています。最新の候補を選び直してください" });
    const candidates = JSON.parse(batch.hypotheses_json) as PreferenceHypothesis[];
    const selected = candidates.filter((item) => input.selectedHypothesisIds.includes(item.id));
    if (selected.length !== input.selectedHypothesisIds.length)
      throw new HTTPException(422, { message: "選択した仮説候補が見つかりません" });
    context.selectedHypotheses = selected;
    context.hypothesisBatchId = batch.id;
    answers = selected.map((item) => ({
      question: "この仮説は、あなたの好みに合っていますか？",
      answer: `選択した好み：${item.description}\n属性：${item.rawLabel}\n反応：${responseChannelLabel(item.responseChannel)}\n好悪：${item.polarity === "positive" ? "好き" : item.polarity === "negative" ? "苦手" : "混在"}\n条件：${item.scope || "特に限定しない"}`,
    }));
  }
  const now = nowIso(),
    step = `preferenceAnalysis:${id}`;
  const quota = await prepareQuotaReservation(env, ownerUserId, "analysis", `refinement:${id}`, hash);
  const outbox = await outboxStatement(
    env,
    ownerUserId,
    "job",
    target.job_id,
    3,
    {
      type: "analysis.start",
      params: {
        jobId: target.job_id,
        ownerUserId,
        entryId,
        stage: "preference",
        inputGeneration: target.revision_number,
        analysisDomain: domain,
        refinementId: id,
      },
    },
    `analysis:${target.job_id}:refinement:${id}`,
    id,
  );
  const guard = `EXISTS (SELECT 1 FROM preference_refinements WHERE id=?)`;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO preference_refinements (id,owner_user_id,entry_revision_id,mode,answers_json,request_hash,created_at,context_json) VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      ownerUserId,
      target.entry_revision_id,
      input.mode === "hypotheses" ? "hypotheses" : "questions",
      JSON.stringify(answers),
      hash,
      now,
      JSON.stringify(context),
    ),
    ...quota.statements,
    env.DB.prepare(
      `UPDATE user_character_entries SET status='analyzing',updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='analysis_review' AND ${guard}`,
    ).bind(now, entryId, ownerUserId, id),
    env.DB.prepare(
      `UPDATE jobs SET status='queued',current_step=?,workflow_instance_id=NULL,error_code=NULL,error_detail_safe=NULL,completed_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND owner_user_id=? AND status='waiting_for_user' AND ${guard}`,
    ).bind(step, now, target.job_id, ownerUserId, id),
    outbox.statement,
  ];
  if (answers.length && target.source_set_id)
    for (const [index, answer] of answers.entries()) {
      const sourceId = crypto.randomUUID(),
        pointer = `/preference/clarifications/${id}/${index}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO sources (id,owner_user_id,title,source_type,citation_json,rights_basis,mime_type,byte_size,content_hash,locator_json,text_content,token_estimate,created_at,updated_at) SELECT ?,?,?,'user_text','{}','user_provided','text/plain',?,?,?,?,?,?,? WHERE ${guard}`,
        ).bind(
          sourceId,
          ownerUserId,
          answer.question,
          new TextEncoder().encode(answer.answer).byteLength,
          await sha256Hex(answer.answer),
          JSON.stringify({ pointer }),
          answer.answer,
          Math.ceil(answer.answer.length / 3),
          now,
          now,
          id,
        ),
        env.DB.prepare(
          `INSERT INTO source_set_items (source_set_id,source_id,priority,usage_type) SELECT ?,?,0,'primary' WHERE ${guard}`,
        ).bind(target.source_set_id, sourceId, id),
      );
    }
  const results = await env.DB.batch(statements);
  if (results.some((item) => !item.success) || !results[0].meta.changes)
    throw new Error("PREFERENCE_REVIEW_STATE_CHANGED");
  return { id, replayed: false, outboxEventId: outbox.id, jobId: target.job_id };
}
