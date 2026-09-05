import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnderstandingInformationNotice } from "../src/features/entries/UnderstandingInformationNotice";
import { assessUnderstandingInformation } from "../worker/features/analysis/understanding-quality";
import fixtures from "./fixtures/sparse-understanding.json";
import { frozenAudit } from "./support/understanding-audit";

describe("understanding information notice", () => {
  it("distinguishes unassessed records from an assessment without a sparse flag", () => {
    const { rerender } = render(<UnderstandingInformationNotice quality={undefined} editable={false} />);
    expect(screen.getByText("解析時点の人物像の情報量は未評価です。")).toBeInTheDocument();
    const quality = assessUnderstandingInformation(frozenAudit(fixtures[8]), false);
    rerender(<UnderstandingInformationNotice quality={quality} editable={false} />);
    expect(screen.queryByText(/未評価|情報が限られています/u)).not.toBeInTheDocument();
  });

  it("shows reasons and continuation guidance, then labels the assessment as historical", () => {
    const quality = assessUnderstandingInformation(frozenAudit(fixtures[0]), true);
    const { rerender } = render(<UnderstandingInformationNotice quality={quality} editable />);
    expect(screen.getByText("解析時点では人物像の情報が限られています")).toBeInTheDocument();
    expect(screen.getByText("不足する属性は追加・修正できます。このまま好み分析へ進めます。")).toBeInTheDocument();
    expect(screen.getByText("物語での役割：役割名だけが残っている。")).toBeInTheDocument();
    rerender(<UnderstandingInformationNotice quality={quality} editable={false} />);
    expect(screen.queryByText(/このまま好み分析へ進めます/u)).not.toBeInTheDocument();
    expect(screen.getByText(/確認時の修正内容は、この判定には反映されません/u)).toBeInTheDocument();
  });
});
