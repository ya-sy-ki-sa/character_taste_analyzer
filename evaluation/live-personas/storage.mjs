import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SAFE_RUNTIME_SETTING_KEYS = [
  "ENVIRONMENT",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_TIER_ROUTES_JSON",
  "LLM_FALLBACK_PROVIDER",
  "LLM_FALLBACK_MODEL",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "MODERATION_PROVIDER",
  "MODERATION_MODEL",
  "JEV_PROVIDER",
  "JEV_MODEL",
  "OPENAI_FLEX_ENABLED",
  "APP_ORIGIN",
];
const FINAL_DISPOSITIONS = new Set(["accepted", "degraded", "rejected"]);
const DEGRADED_REASON_CODES = new Set(["accepted_explicit_fallback", "accepted_verified_subset"]);
const MAX_JUDGMENT_LOG_BYTES = 64 * 1024 * 1024;

export function liveRunRoot(value = process.env.LIVE_RUN_DIR) {
  if (!value) throw new Error("LIVE_RUN_DIR is required; use a new directory for each measurement");
  const root = resolve(value);
  if (existsSync(`${root}/final-artifact-manifest.json`))
    throw new Error("Finalized live evaluation is read-only; use a new run directory");
  return root;
}

export function digest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function selectSafeRuntimeSettings(environment, defaults = {}) {
  return Object.fromEntries(SAFE_RUNTIME_SETTING_KEYS.map((key) => [key, environment[key] ?? defaults[key] ?? null]));
}

function boundedString(value, maximum = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function sanitizeProbabilities(value) {
  if (Array.isArray(value)) {
    if (value.length > 256) return null;
    const values = value.map(probability);
    return values.every((item) => item !== null) ? values : null;
  }
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value);
  if (entries.length > 256) return null;
  const sanitized = entries.map(([key, item]) => [boundedString(key), probability(item)]);
  return sanitized.every(([key, item]) => key !== null && item !== null) ? Object.fromEntries(sanitized) : null;
}

function sanitizeDecision(value) {
  if (!value || typeof value !== "object") return null;
  const id = boundedString(value.id);
  if (!id || !["choice", "noul", "score"].includes(value.type)) return null;
  const selected = value.type === "choice" ? boundedString(value.selected) : probability(value.selected);
  if (selected === null) return null;
  return {
    id,
    type: value.type,
    selected,
    confidence: value.type === "noul" ? null : probability(value.confidence),
    probabilities: value.type === "noul" ? null : sanitizeProbabilities(value.probabilities),
  };
}

function sanitizeJudgmentEvent(value) {
  if (!value || typeof value !== "object" || value.event !== "judgment_completed") return null;
  const correlationId = boundedString(value.correlationId);
  const stage = boundedString(value.stage);
  if (!correlationId || !stage) return null;
  const answers = Array.isArray(value.decisions) ? value.decisions.map(sanitizeDecision).filter(Boolean) : null;
  return {
    correlationId,
    stage,
    domain: boundedString(value.domain),
    provider: boundedString(value.provider),
    model: boundedString(value.model),
    policyVersion: boundedString(value.policyVersion),
    questionHash: boundedString(value.questionHash),
    questionCount:
      Number.isInteger(value.questionCount) && value.questionCount >= 0 && value.questionCount <= 10_000
        ? value.questionCount
        : null,
    answers,
  };
}

function parseLogObject(line) {
  const candidates = [line.trim()];
  const start = line.indexOf("{");
  const end = line.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(line.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.message === "string") {
          const nested = parseLogObject(parsed.message);
          if (nested) return nested;
        }
        return parsed;
      }
    } catch {
      // Development servers may prefix structured application logs.
    }
  }
  return null;
}

export function sanitizeJudgmentLog(text) {
  if (typeof text !== "string") throw new Error("Judgment log must be text");
  return text.split(/\r?\n/u).map(parseLogObject).map(sanitizeJudgmentEvent).filter(Boolean);
}

export function readSanitizedJudgmentLog(path = process.env.LIVE_APP_LOG_FILE) {
  if (!path) return [];
  if (!existsSync(path)) throw new Error(`LIVE_APP_LOG_FILE not found: ${path}`);
  if (statSync(path).size > MAX_JUDGMENT_LOG_BYTES) throw new Error("LIVE_APP_LOG_FILE exceeds 64 MiB");
  return sanitizeJudgmentLog(readFileSync(path, "utf8"));
}

function parseEmbeddedJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function finalDisposition(assertion) {
  const direct = assertion.finalDisposition ?? assertion.judgmentDisposition ?? assertion.disposition;
  if (FINAL_DISPOSITIONS.has(direct)) return { value: direct, source: "export" };
  if (assertion.keep === false) return { value: "rejected", source: "final_policy_outcome" };
  if (assertion.keep === true)
    return {
      value: DEGRADED_REASON_CODES.has(assertion.reasonCode) ? "degraded" : "accepted",
      source: "final_policy_outcome",
    };
  return null;
}

function sanitizeOutcome(assertion, stage, runId, entryRevisionId, policyVersion) {
  if (!assertion || typeof assertion !== "object") return null;
  const disposition = finalDisposition(assertion);
  const targetId = boundedString(assertion.targetId);
  const reasonCode = boundedString(assertion.reasonCode);
  if (!disposition || !targetId || !reasonCode) return null;
  const diagnosticCodes = [
    ...new Set(
      [
        ...(Array.isArray(assertion.diagnosticCodes) ? assertion.diagnosticCodes : []),
        ...(["invalid_set_index", "high_conflict"].includes(assertion.reasonCode) ? [assertion.reasonCode] : []),
      ]
        .map((code) => boundedString(code, 128))
        .filter(Boolean),
    ),
  ];
  const confidence = probability(assertion.after?.confidence);
  return {
    stage,
    runId: boundedString(runId),
    entryRevisionId: boundedString(entryRevisionId),
    targetId,
    disposition: disposition.value,
    dispositionSource: disposition.source,
    confidence,
    reasonCode,
    diagnosticCodes,
    policyVersion: boundedString(assertion.policyVersion ?? policyVersion),
  };
}

function semanticOutcomes(container, stage, runId, entryRevisionId) {
  const audit = parseEmbeddedJson(container)?.semanticAudit;
  if (!audit || typeof audit !== "object" || !Array.isArray(audit.assertions)) return [];
  return audit.assertions
    .map((assertion) => sanitizeOutcome(assertion, stage, runId, entryRevisionId, audit.policyVersion))
    .filter(Boolean);
}

function auditAnswerCount(artifact) {
  return (artifact?.calls ?? []).reduce(
    (total, call) => total + (Array.isArray(call.answers) ? call.answers.length : 0),
    0,
  );
}

function coverage(calls, outcomes) {
  return {
    answers: calls.some((call) => Array.isArray(call.answers))
      ? "available"
      : calls.length
        ? "decisions_unavailable"
        : "log_unavailable",
    finalOutcomes: outcomes.length ? "available" : "export_unavailable",
  };
}

export function buildCaseJudgmentAudits(exported, caseStates, judgmentEvents = [], sourceExport = null) {
  const revisions = Array.isArray(exported?.entries?.revisions) ? exported.entries.revisions : [];
  const understandingRuns = Array.isArray(exported?.understanding?.runs) ? exported.understanding.runs : [];
  const understandingSnapshots = Array.isArray(exported?.understanding?.snapshots)
    ? exported.understanding.snapshots
    : [];
  const preferenceRuns = Array.isArray(exported?.preferenceAnalysis?.runs) ? exported.preferenceAnalysis.runs : [];
  const understandingById = new Map(understandingRuns.map((run) => [run.id, run]));
  const artifacts = {};
  for (const [caseId, state] of Object.entries(caseStates ?? {})) {
    if (!state?.entryId) continue;
    const excluded = new Set(Array.isArray(state.excludedRevisions) ? state.excludedRevisions : []);
    const caseRevisions = revisions.filter(
      (revision) => revision.entry_id === state.entryId && !excluded.has(revision.revision_number),
    );
    if (!caseRevisions.length) continue;
    const revisionIds = new Set(caseRevisions.map((revision) => revision.id));
    const outcomes = [
      ...preferenceRuns.flatMap((run) =>
        revisionIds.has(run.entry_revision_id)
          ? semanticOutcomes(run.quality_context_json, "preference", run.id, run.entry_revision_id)
          : [],
      ),
      ...understandingSnapshots.flatMap((snapshot) => {
        const run = understandingById.get(snapshot.understanding_run_id);
        return run && revisionIds.has(run.entry_revision_id)
          ? semanticOutcomes(snapshot.source_assessment_json, "understanding", run.id, run.entry_revision_id)
          : [];
      }),
    ];
    const calls = judgmentEvents.filter((event) => revisionIds.has(event.correlationId));
    artifacts[caseId] = {
      schemaVersion: "live-judgment-audit/v1",
      caseId,
      entryId: state.entryId,
      entryRevisionIds: [...revisionIds],
      sourceExport: boundedString(sourceExport, 1_000),
      coverage: coverage(calls, outcomes),
      calls,
      outcomes,
    };
  }
  return artifacts;
}

export function saveCaseJudgmentAudits(root, exported, caseStates, judgmentEvents = [], sourceExport = null) {
  const artifacts = buildCaseJudgmentAudits(exported, caseStates, judgmentEvents, sourceExport);
  for (const [caseId, artifact] of Object.entries(artifacts)) {
    const path = `${root}/cases/${caseId}/judgment-audit.json`;
    const current = readJson(path, null);
    if (current && auditAnswerCount(current) > auditAnswerCount(artifact)) artifact.calls = current.calls;
    artifact.coverage = coverage(artifact.calls, artifact.outcomes);
    saveJson(path, artifact);
  }
  return artifacts;
}
export function preserveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
}
export function sameInput(a, b) {
  const keys = [
    "registrationType",
    "workTitle",
    "characterName",
    "mediaType",
    "preferenceContext",
    "userCharacterView",
    "referenceMaterial",
  ];
  return (
    keys.every((k) => (a[k] ?? "") === (b[k] ?? "")) &&
    ["likedReasons", "dislikedReasons", "valueStanceNote"].every(
      (k) => (a.preference[k] ?? "") === (b.preference[k] ?? ""),
    ) &&
    JSON.stringify(a.preference.responseChannels ?? []) === JSON.stringify(b.preference.responseChannels ?? [])
  );
}
export function selectResumeEntry(matches) {
  if (matches.length > 1) throw new Error("AMBIGUOUS_EXISTING_ENTRIES: refusing duplicate submission");
  return matches[0] ?? null;
}
