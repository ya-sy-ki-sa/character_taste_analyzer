import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { EvidenceDetail } from "../shared/contracts/entry-review";
import { EvidenceList } from "../src/features/entries/EvidenceList";

afterEach(cleanup);

it("英語Wikipediaの取得元と原文リンクを表示し、移動不可の根拠は出典名だけにする", () => {
  const evidence: EvidenceDetail = {
    id: "english-evidence",
    verificationStatus: "verified_quote",
    evidenceOrigin: "source",
    inferenceType: "direct",
    quote: "An evidence display example.",
    inputPointer: null,
    sourceTitle: "出典の表示例",
    sourceUrl: "https://en.wikipedia.org/wiki/Example",
    sourceProvider: "wikipedia_en",
    trustReason: "表示確認用",
    canNavigate: true,
  };
  const { container, rerender } = render(<EvidenceList evidence={[evidence]} />);
  expect(screen.getByText(/取得元: 英語Wikipedia/u)).toBeInTheDocument();
  expect(container.querySelector("a")).toHaveAttribute("href", evidence.sourceUrl);
  expect(container.querySelector("a")).toHaveTextContent("原文へ移動");
  rerender(<EvidenceList evidence={[{ ...evidence, canNavigate: false }]} />);
  expect(container.querySelector("a")).toBeNull();
  expect(screen.getByText("出典: 出典の表示例")).toBeInTheDocument();
});
