import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ValueStanceList } from "../src/features/profile/ValueStanceList";

afterEach(cleanup);

it("空の価値態度を隠し、グループの項目数と各項目の集計件数を区別する", () => {
  const { container, rerender } = render(<ValueStanceList items={[]} />);
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  const item = { orientation: "evil", stance: "affirm", count: 3, labels: ["悪役的方向性"] };
  rerender(
    <ValueStanceList
      items={[
        { ...item, scope: { subjects: ["人物A"], exceptions: ["現実の行為への支持とは区別する"] } },
        { ...item, stance: "reject", count: 2, labels: ["冷淡"] },
        { orientation: "good", stance: "accept", count: 1, labels: [] },
      ]}
    />,
  );
  expect([...container.querySelectorAll(".value-stance-group-title")].map((node) => node.textContent)).toEqual([
    "悪そのもの2件",
    "善を重視する姿勢1件",
  ]);
  expect(screen.getByText("肯定的に捉える・3件")).toBeInTheDocument();
  expect(screen.getByText("支持しない・2件")).toBeInTheDocument();
  expect(container.querySelector(".value-stance-details dl")).toHaveTextContent(
    "例外・除外現実の行為への支持とは区別する",
  );
});

it("詳細として表示できる文脈がない項目には空の開閉欄を作らない", () => {
  const { container } = render(
    <ValueStanceList
      items={[{ orientation: "good", stance: "accept", count: 3, labels: [], scope: { unknown: "非表示" } }]}
    />,
  );
  expect(container.querySelector(".value-stance-group-count")).toHaveTextContent("1件");
  expect(screen.getByText("受け入れる・3件")).toBeInTheDocument();
  expect(container.querySelector("li details, li summary, li dl")).toBeNull();
  expect(screen.queryByText(/対象人物|非表示/u)).not.toBeInTheDocument();
});
