import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Recommendations } from "../src/components/Recommendations";

const candidate = (index: number) => ({
  characterName: `候補人物${index}`,
  workTitle: `候補作品${index}`,
  mediaType: "小説",
  matchedTraitIds: ["temperament.stoic"],
  reason: "冷静な振る舞いが分析傾向と一致します。",
  possibleMismatch: index === 1 ? "感情表現の方向は好みと異なる可能性があります。" : null,
  likelihood: index === 1 ? ("exploratory" as const) : ("medium" as const),
});

const succeeded = {
  id: "recommendation-1",
  profileSnapshotId: "profile-1",
  status: "succeeded",
  result: {
    selectionNote: "作品が偏らないように選びました。",
    candidates: [1, 2, 3, 4].map(candidate),
  },
  errorCode: null,
  createdAt: "2026-08-29T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("recommendation UI", () => {
  it("requests a fresh LLM selection and renders the structured candidates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { recommendations: [] } }))
      .mockResolvedValueOnce(Response.json({ data: { recommendation: succeeded } }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <Recommendations profileSnapshotId="profile-1" />
      </QueryClientProvider>,
    );

    const button = await screen.findByRole("button", { name: /候補を表示/u });
    fireEvent.click(button);

    await screen.findByRole("heading", { name: "候補人物1" });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getAllByText("冷静・ストイック")).toHaveLength(4);
    expect(screen.getByText(/感情表現の方向/u)).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });
});
