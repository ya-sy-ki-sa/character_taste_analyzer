import { randomUUID } from "node:crypto";

const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:5173/api/v1";
let cookie = "";
let csrf = "";

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  if (csrf && !["GET", "HEAD"].includes(init.method ?? "GET")) headers.set("X-CSRF-Token", csrf);
  if (!["GET", "HEAD"].includes(init.method ?? "GET"))
    headers.set("Idempotency-Key", init.idempotencyKey ?? randomUUID());
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload?.data ?? payload;
}

async function waitEntry(entryId, expected) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = await request(`/entries/${entryId}`);
    if (detail.entry.status === expected) return detail;
    if (detail.entry.status === "failed") throw new Error(`entry failed while waiting for ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`entry did not reach ${expected}`);
}

const health = await request("/health");
if (health.llmProvider !== "replay") throw new Error(`smoke test must use replay, got ${health.llmProvider}`);
const registrationKey = randomUUID();
const user = await request("/users", {
  method: "POST",
  idempotencyKey: registrationKey,
  body: JSON.stringify({ username: `e2e-villain-${Date.now()}`, idempotencyKey: registrationKey }),
});
await request(`/users/${user.user.id}/activate`, {
  method: "POST",
  body: JSON.stringify({ accessKey: user.accessKey }),
});
const session = await request("/sessions", {
  method: "POST",
  body: JSON.stringify({ userId: user.user.id, accessKey: user.accessKey }),
});
csrf = session.csrfToken;

const created = await request("/entries", {
  method: "POST",
  body: JSON.stringify({
    schemaVersion: "1",
    registrationType: "customized_existing",
    workTitle: "架空検証作品",
    characterName: "黒曜卿",
    mediaType: "小説",
    representationType: "facet",
    customizationDescription: "表向きではなく、善への無関心を明言し残酷さを楽しむ裏人格だけ。最後まで改心しない。",
    knownScope: "第7章で現れる裏人格だけ",
    sourceText:
      "黒曜卿は物語のヴィランである。裏人格は狡猾で冷酷、他者の苦痛を楽しみ、善悪を判断軸にしない。破壊そのものを選び、最後まで改心を拒む。一場面だけ登場する端役だが物語の方向を変える。",
    userCharacterView: "悲しい過去で正当化されない純粋悪として解釈している。",
    preference: {
      likedReasons:
        "ヴィランとして純粋悪で、非道徳と残酷さを穏当化せず、善への無関心を貫き、改心しないところが好き。端役なのに強烈。",
      dislikedReasons: "実は優しいという補正は苦手。",
      responseChannels: [
        "person_liking",
        "fascination_with_transgression",
        "narrative_interest",
        "root_for",
        "desire_no_redemption",
      ],
      valueStanceNote: "フィクション上では悪そのものを肯定し、改心しないことを望む。現実の行為を支持する意味ではない。",
    },
  }),
});

let detail = await waitEntry(created.entryId, "understanding_review");
await request(`/entries/${created.entryId}/understanding-review`, {
  method: "POST",
  body: JSON.stringify({ decision: "confirm_all", targetIds: [detail.understanding.id] }),
});
detail = await waitEntry(created.entryId, "analysis_review");
await request(`/entries/${created.entryId}/preference-review`, {
  method: "POST",
  body: JSON.stringify({ decision: "confirm_all", targetIds: [detail.preferenceAnalysis.id] }),
});

const profile = (await request("/profile")).profile;
const graph = (await request("/profile/graph?detail=standard")).graph;
const snapshot = await request("/profile/snapshot-items");
if (!profile?.dimensions.length || !graph?.nodes.length || snapshot.items.length < 1)
  throw new Error("profile or graph was not created");
const selectedItemIds = snapshot.items.slice(0, 3).map((item) => item.id);
const generation = await request("/generation-requests", {
  method: "POST",
  body: JSON.stringify({
    mode: "balanced",
    purpose: "ヴィラン寄りの端役を作る",
    world: "記憶が通貨になる都市",
    role: "一場面で物語を変えるヴィラン",
    selectedItemIds,
    prohibitedItemIds: [],
    redemption: "prohibited",
    hiddenGoodness: "prohibited",
  }),
});
let generated;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const rows = (await request("/generated-characters")).generations;
  generated = rows.find((row) => row.generationRequestId === generation.generationRequestId);
  if (generated?.status === "generated") break;
  if (generated?.status === "failed") throw new Error(`generation failed: ${generated.job.errorCode}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!generated?.character) throw new Error("generated character was not persisted");

console.log(
  JSON.stringify(
    {
      provider: health.llmProvider,
      entryStatus: "active",
      profileDimensions: profile.dimensions.length,
      valueStances: profile.valueStances.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      generationStatus: generated.status,
      generatedCharacter: generated.character.identity.name,
    },
    null,
    2,
  ),
);
