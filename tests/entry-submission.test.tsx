import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisDomain } from "../shared/analysis-domain";
import type { RegistrationType } from "../shared/contracts/taxonomy";
import { EntriesPage } from "../src/pages/EntriesPage";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status });
}

function failure(message: string) {
  return new Response(JSON.stringify({ error: { code: "TEST_FAILURE", message } }), { status: 503 });
}

function deferredResponse() {
  let resolve: (value: Response) => void = () => {};
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const candidate = {
  workId: "test-work",
  characterIdentityId: "test-identity",
  workTitle: "作品",
  characterName: "人物",
};

async function setup({
  domain = "standard",
  registrationType = "existing",
  reanalysis = false,
}: {
  domain?: AnalysisDomain;
  registrationType?: RegistrationType;
  reanalysis?: boolean;
} = {}) {
  const base = domain === "dark" ? "/api/v1/dark" : "/api/v1";
  const draft = {
    registrationType,
    workTitle: "作品",
    characterName: "人物",
    baseCharacterName: "原典の人物",
    representationType: "user_interpretation",
    customizationDescription: "独自の解釈",
    characterBasicInfo: "知略で立ち向かう人物",
    mediaType: "アニメ版",
    preference: {
      likedReasons: "知略が好き",
      responseChannels: [domain === "dark" ? "dark_character_liking" : "person_liking"],
    },
    identityResolution: { mode: "reuse", workId: candidate.workId, characterIdentityId: candidate.characterIdentityId },
    ...(domain === "dark" ? { darkContext: { focusDescription: "敵対する状態", archetypeHints: [] } } : {}),
  };
  const existingEntry = {
    id: "entry-id",
    registrationType,
    status: "active",
    title: "人物",
    subtitle: "作品",
    updatedAt: "2026-09-05T00:00:00.000Z",
    activeRevisionNumber: 1,
    reviewTargetId: null,
    job: null,
  };
  const lookup = vi.fn(async (_init?: RequestInit) => response({ candidates: [] }));
  const save = vi.fn(async (_init?: RequestInit) =>
    response({ entryId: "entry-id", jobId: "job-id", status: "submitted" }, 202),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === `${base}/identity-candidates`) return lookup(init);
    if (init?.method === "POST") return save(init);
    if (path === `${base}/entries/entry-id`) return response({ entry: { ...existingEntry, draft } });
    if (path === `${base}/entries`) return response({ entries: reanalysis ? [existingEntry] : [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntriesPage domain={domain} />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: reanalysis ? "入力を見直して再分析" : "＋ キャラクターを登録" }),
  );
  if (reanalysis) {
    await screen.findByLabelText("好きな理由");
  } else {
    if (registrationType !== "existing") {
      fireEvent.click(
        screen.getByRole("button", {
          name: registrationType === "original" ? "オリジナル" : "既成（カスタム）",
        }),
      );
    }
    if (registrationType !== "original")
      fireEvent.change(screen.getByLabelText("作品名 必須"), { target: { value: "作品" } });
    fireEvent.change(screen.getByLabelText(/^キャラクター名 必須/u), { target: { value: "人物" } });
    if (registrationType === "customized_existing") {
      fireEvent.change(screen.getByLabelText(/^既成キャラクター名 必須/u), { target: { value: "原典の人物" } });
      fireEvent.change(screen.getByLabelText("基本像からどう違うか 必須"), { target: { value: "独自の解釈" } });
    }
    if (registrationType === "original")
      fireEvent.change(screen.getByLabelText(/^キャラクター基本情報 必須/u), {
        target: { value: draft.characterBasicInfo },
      });
    if (domain === "dark")
      fireEvent.change(screen.getByLabelText("注目するダーク状態・役割 必須"), { target: { value: "敵対する状態" } });
  }
  const dialog = screen.getByRole("dialog");
  const form = dialog.querySelector("form");
  if (!form) throw new Error("Registration form is missing");
  return {
    lookup,
    save,
    dialog,
    form,
    start: within(dialog).getByRole("button", { name: reanalysis ? "入力を保存して再分析" : "保存して理解抽出を開始" }),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(["standard", "dark"] as const)("%s の登録・再分析", (domain) => {
  it.each(["existing", "customized_existing", "original"] as const)(
    "%s の開始中は入力と再送信を無効にする",
    async (registrationType) => {
      const { lookup, save, dialog, form, start } = await setup({ domain, registrationType });
      const checking = deferredResponse();
      const saving = deferredResponse();
      lookup.mockReturnValueOnce(checking.promise);
      save.mockReturnValueOnce(saving.promise);
      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      expect(start).toBeDisabled();
      for (const input of dialog.querySelectorAll("input,textarea,select")) expect(input).toBeDisabled();
      if (registrationType === "original") {
        expect(lookup).not.toHaveBeenCalled();
      } else {
        expect(start).toHaveTextContent("候補を確認中…");
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
        await act(async () => checking.resolve(response({ candidates: [] })));
      }
      await waitFor(() => expect(start).toHaveTextContent("保存・開始中…"));
      expect(start).toBeDisabled();
      fireEvent.submit(form);
      expect(save).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(save.mock.calls[0][0]?.body));
      expect(body.identityResolution ?? { mode: "new" }).toEqual({ mode: "new" });
      if (registrationType === "customized_existing") {
        expect(JSON.parse(String(lookup.mock.calls[0][0]?.body))).toMatchObject({ characterName: "原典の人物" });
      }
      await act(async () => saving.resolve(response({ entryId: "entry-id" }, 202)));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
    },
  );

  it.each(["reuse", "new"] as const)("候補がある場合は選択してから %s として保存する", async (mode) => {
    const { lookup, save, start, form, dialog } = await setup({ domain });
    lookup.mockResolvedValueOnce(response({ candidates: [candidate] }));
    fireEvent.click(start);
    const choice = await within(dialog).findByRole("radio", { name: /既存の同一人物情報を再利用：/u });
    expect(save).not.toHaveBeenCalled();
    expect(start).toBeEnabled();
    expect(choice).not.toBeChecked();
    fireEvent.submit(form);
    expect(save).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("既存の同一人物情報を再利用するか、別物として新規登録するか選んでください"),
    ).toBeVisible();
    fireEvent.click(
      mode === "reuse" ? choice : within(dialog).getByRole("radio", { name: "同名だが別物として新規登録" }),
    );
    fireEvent.click(start);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(save.mock.calls[0][0]?.body)).identityResolution).toEqual(
      mode === "reuse"
        ? { mode, workId: candidate.workId, characterIdentityId: candidate.characterIdentityId }
        : { mode },
    );
  });

  it("確認エラーを表示して保存を止め、入力を保持して再試行する", async () => {
    const { lookup, save, start, dialog } = await setup({ domain });
    lookup.mockResolvedValueOnce(failure("候補を取得できませんでした"));
    fireEvent.click(start);
    await within(dialog).findByText("候補を取得できませんでした");
    expect(start).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("作品名 必須")).toHaveValue("作品");
    fireEvent.click(start);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("保存失敗後は内容に対応するキーを再利用する（再分析: %s）", async (reanalysis) => {
    const { lookup, save, start, dialog } = await setup({ domain, reanalysis });
    save.mockImplementation(async () => failure("保存の応答を取得できませんでした"));
    const likedReasons = within(dialog).getByLabelText("好きな理由");
    const initialValue = (likedReasons as HTMLTextAreaElement).value;
    for (const value of [initialValue, initialValue, "追加した理由", initialValue]) {
      fireEvent.change(likedReasons, { target: { value } });
      fireEvent.click(start);
      await within(dialog).findByText("保存の応答を取得できませんでした");
      expect(likedReasons).toHaveValue(value);
      expect(start).toBeEnabled();
    }
    const keys = save.mock.calls.map(([init]) => new Headers(init?.headers).get("Idempotency-Key"));
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).toBe(keys[0]);
    if (reanalysis) {
      expect(lookup).not.toHaveBeenCalled();
      expect(JSON.parse(String(save.mock.calls[0][0]?.body)).draft.identityResolution).toEqual({
        mode: "reuse",
        workId: candidate.workId,
        characterIdentityId: candidate.characterIdentityId,
      });
    }
  });

  it("作品・人物・媒体を変更したら候補の選択を破棄して確認し直す", async () => {
    const { lookup, save, start, dialog } = await setup({ domain, registrationType: "customized_existing" });
    lookup.mockImplementation(async () => response({ candidates: [candidate] }));
    for (const [label, value] of [
      ["媒体・版", "ゲーム版"],
      ["作品名 必須", "別の作品"],
      [/^既成キャラクター名 必須/u, "別の原典"],
    ] as const) {
      fireEvent.click(start);
      const choice = await within(dialog).findByRole("radio", { name: /既存の同一人物情報を再利用：/u });
      fireEvent.click(choice);
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    }
    lookup.mockResolvedValueOnce(response({ candidates: [] }));
    fireEvent.click(start);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(lookup.mock.calls[3][0]?.body))).toEqual({
      workTitle: "別の作品",
      characterName: "別の原典",
      mediaType: "ゲーム版",
    });
    expect(JSON.parse(String(save.mock.calls[0][0]?.body)).identityResolution).toEqual({ mode: "new" });
  });

  it("再分析で人物を変更した場合も、候補確認から保存まで多重送信を拒否する", async () => {
    const { lookup, save, start, dialog, form } = await setup({ domain, reanalysis: true });
    const checking = deferredResponse();
    const saving = deferredResponse();
    lookup.mockReturnValueOnce(checking.promise);
    save.mockReturnValueOnce(saving.promise);
    fireEvent.change(within(dialog).getByLabelText("キャラクター名 必須"), { target: { value: "変更後の人物" } });
    fireEvent.change(within(dialog).getByLabelText("媒体・版"), { target: { value: "ゲーム版" } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(start).toBeDisabled();
    await act(async () => checking.resolve(response({ candidates: [] })));
    await waitFor(() => expect(start).toHaveTextContent("保存・開始中…"));
    expect(start).toBeDisabled();
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(save.mock.calls[0][0]?.body)).draft).toMatchObject({
      mediaType: "ゲーム版",
      identityResolution: { mode: "new" },
    });
    await act(async () => saving.resolve(response({ entryId: "entry-id" }, 202)));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });
});
