import type { UnderstandingInformationQuality } from "../../../shared/contracts/understanding-quality";
import { understandingAspectLabels, understandingAspects } from "../../../shared/understanding-aspects";
import { Notice } from "../../components/Ui";

export function UnderstandingInformationNotice({
  quality,
  editable,
}: {
  quality: UnderstandingInformationQuality | undefined;
  editable: boolean;
}) {
  if (!quality) return <p className="section-help understanding-information">解析時点の人物像の情報量は未評価です。</p>;
  const counts = (
    <p className="section-help understanding-information">
      解析時点の情報量：文章のある項目 {quality.contentAspectCount}/7、具体的描写のある項目{" "}
      {quality.concreteAspectCount}/7
    </p>
  );
  if (quality.status !== "limited")
    return (
      <>
        {counts}
        <p className="section-help understanding-information">今回の不足基準には該当しません。解析時点の判定です。</p>
      </>
    );
  return (
    <>
      {counts}
      <Notice>
        <strong>解析時点では人物像の情報が限られています</strong>
        {quality.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <details>
          <summary>項目ごとの不足理由</summary>
          <ul>
            {understandingAspects
              .filter((aspect) => quality.aspects[aspect].kind !== "concrete")
              .map((aspect) => (
                <li key={aspect}>
                  {understandingAspectLabels[aspect]}：{quality.aspects[aspect].reason}
                </li>
              ))}
          </ul>
        </details>
        <p>
          {editable
            ? "不足する属性は追加・修正できます。このまま好み分析へ進めます。"
            : "これは解析時点の判定です。確認時の修正内容は、この判定には反映されません。"}
        </p>
      </Notice>
    </>
  );
}
