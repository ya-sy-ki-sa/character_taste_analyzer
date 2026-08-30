import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntriesPage } from "../src/pages/EntriesPage";

function entry(
  status: "failed" | "submitted" | "active" | "understanding_review" | "analysis_review",
  retryable: boolean,
) {
  return {
    id: "9fd3b2d6-cd4b-4f3a-8907-a0f1281270d7",
    registrationType: "existing" as const,
    status,
    title: "再実行テスト",
    subtitle: "架空作品",
    activeRevisionNumber: 1,
    updatedAt: "2026-08-30T00:00:00.000Z",
    reviewTargetId: null,
    job: {
      id: "ed640ee8-93ac-4e23-9bb8-d7d55880041e",
      status: status === "failed" ? "failed" : status === "active" ? "succeeded" : "queued",
      retryable,
      currentStep: status === "failed" ? "understandCharacter" : "queued",
      progressCurrent: 0,
      progressTotal: 15,
      errorCode: status === "failed" ? "EXTERNAL_PROVIDER_UNAVAILABLE" : null,
    },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EntriesPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("登録済みキャラクターの再分析", () => {
  it("現在の好きな理由を編集し、新しい再分析を開始できる", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.endsWith("/reanalysis") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              entryId: "9fd3b2d6-cd4b-4f3a-8907-a0f1281270d7",
              entryRevisionId: crypto.randomUUID(),
              revisionNumber: 2,
              jobId: crypto.randomUUID(),
              status: "submitted",
              replayed: false,
            },
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.endsWith("/api/v1/entries/9fd3b2d6-cd4b-4f3a-8907-a0f1281270d7")) {
        return new Response(
          JSON.stringify({
            data: {
              entry: {
                id: "9fd3b2d6-cd4b-4f3a-8907-a0f1281270d7",
                status: "active",
                registrationType: "existing",
                draft: {
                  schemaVersion: "2",
                  registrationType: "existing",
                  workTitle: "架空作品",
                  characterName: "再実行テスト",
                  mediaType: "アニメ版",
                  preferenceContext: "第3話の決戦時",
                  referenceMaterial: "以前の参考情報",
                  userCharacterView: "以前のキャラクター解釈",
                  identityResolution: { mode: "new" },
                  preference: { likedReasons: "以前の理由", responseChannels: ["person_liking"] },
                },
              },
              understanding: null,
              baseUnderstanding: null,
              preferenceAnalysis: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { entries: [entry("active", false)] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "入力を見直して再分析" }));
    const likedReasons = await screen.findByLabelText("好きな理由");
    expect(screen.getByLabelText("作品名 必須")).toHaveValue("架空作品");
    expect(screen.getByLabelText("キャラクター名 必須")).toHaveValue("再実行テスト");
    expect(screen.getByLabelText("媒体・版")).toHaveValue("アニメ版");
    expect(screen.getByLabelText("特に好きな時期・場面・状態（任意）")).toHaveValue("第3話の決戦時");
    fireEvent.change(screen.getByLabelText("解析に加えたい参考情報（任意）"), {
      target: { value: "見直して追加した参考情報" },
    });
    fireEvent.change(screen.getByLabelText("あなた自身のキャラクター解釈"), {
      target: { value: "見直した新しい解釈" },
    });
    fireEvent.change(likedReasons, { target: { value: "思い出して追加した新しい理由" } });
    fireEvent.click(screen.getByRole("button", { name: "入力を保存して再分析" }));

    await screen.findByText("入力を新しい履歴として保存し、キャラクター理解から再分析を開始しました。");
    const reanalysisCall = fetchMock.mock.calls.find(([path]) => String(path).endsWith("/reanalysis"));
    expect(reanalysisCall?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(reanalysisCall?.[1]?.body))).toMatchObject({
      draft: {
        schemaVersion: "2",
        workTitle: "架空作品",
        characterName: "再実行テスト",
        mediaType: "アニメ版",
        preferenceContext: "第3話の決戦時",
        referenceMaterial: "見直して追加した参考情報",
        userCharacterView: "見直した新しい解釈",
        preference: { likedReasons: "思い出して追加した新しい理由", responseChannels: ["person_liking"] },
      },
    });
  });

  it.each(["understanding_review", "analysis_review"] as const)(
    "%s の確認待ちにも再分析ボタンを表示する",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { entries: [entry(status, false)] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      renderPage();
      expect(await screen.findByRole("button", { name: "入力を見直して再分析" })).toBeInTheDocument();
    },
  );
});

describe("解析エラーの再実行", () => {
  it("再実行可能なジョブをAPIへ送信し、受付結果を表示する", async () => {
    let retried = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.endsWith("/retry") && init?.method === "POST") {
        retried = true;
        return new Response(
          JSON.stringify({
            data: {
              jobId: "ed640ee8-93ac-4e23-9bb8-d7d55880041e",
              entryId: "9fd3b2d6-cd4b-4f3a-8907-a0f1281270d7",
              stage: "understanding",
              status: "queued",
            },
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: { entries: [entry(retried ? "submitted" : "failed", true)] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    renderPage();
    const retryButton = await screen.findByRole("button", { name: "解析を再実行" });
    fireEvent.click(retryButton);

    await screen.findByText("「再実行テスト」の解析を再実行しています。");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/jobs/ed640ee8-93ac-4e23-9bb8-d7d55880041e/retry",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("再実行できないエラーにはボタンを表示しない", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { entries: [entry("failed", false)] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderPage();
    await screen.findByText("EXTERNAL_PROVIDER_UNAVAILABLE");
    expect(screen.queryByRole("button", { name: "解析を再実行" })).not.toBeInTheDocument();
  });
});
