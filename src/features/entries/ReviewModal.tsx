import type { AnalysisDomain } from "../../../shared/analysis-domain";
import { responseChannelLabel } from "../../../shared/response-channels";
import { valueOrientationLabel, valueStanceLabel } from "../../../shared/value-stance-labels";
import { Card, Modal, Notice, Spinner } from "../../components/Ui";
import { explicitnessLabel } from "../../lib/analysis-labels";
import { groupPreferenceAssertions, normalizePreferenceLabel } from "../../lib/preference-assertion-groups";
import { AddAssertionControl, AssertionReviewControls } from "./AssertionReviewControls";
import { AddDeltaControl, CustomizationDeltaCard } from "./CustomizationDeltaControls";
import { EvidenceList } from "./EvidenceList";
import { AddPreferenceAssertionControl, PreferenceAssertionEditControl } from "./PreferenceAssertionControls";
import { PreferenceRefinement } from "./PreferenceRefinement";
import { reanalyzableStatuses, reviewSummaryValue, statusLabels, understandingSummaryLabel } from "./presentation";
import { useEntryReview } from "./use-entry-review";
import { AddValueStanceControl, ValueStanceEditControl } from "./ValueStanceControls";

export function ReviewModal({
  domain,
  entryId,
  onClose,
  onUpdated,
  onReanalyze,
}: {
  domain: AnalysisDomain;
  entryId: string;
  onClose(): void;
  onUpdated(): void;
  onReanalyze(): void;
}) {
  const {
    submitting,
    error,
    detail,
    confirm,
    mutateUnderstandingSnapshot,
    rejectPreferenceItem,
    mutatePreference,
    reviewDarkScope,
    value,
  } = useEntryReview({ domain, entryId, onUpdated });
  return (
    <Modal title="解析内容の確認" onClose={onClose} wide>
      {detail.isPending && <Spinner />}
      {detail.isError && <Notice tone="danger">内容を読み込めませんでした。</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {value && (
        <div className="review-stack">
          <Notice tone={value.entry.status === "failed" ? "danger" : "info"}>
            現在: {statusLabels[value.entry.status] ?? "状態を確認中"}
          </Notice>
          {value.darkScopeAssessment?.status === "proposed" && (
            <Card>
              <p className="eyebrow">DARK SCOPE REVIEW</p>
              <h3>ダークラボの対象外と判定されました</h3>
              <p>{value.darkScopeAssessment.assessment.rationale}</p>
              {value.darkScopeAssessment.assessment.limitations.map((item) => (
                <p className="muted" key={item}>
                  {item}
                </p>
              ))}
              <Notice tone="warning">
                対象とする限定状態や独自解釈が明示されている場合は、判定を上書きして続行できます。
              </Notice>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={submitting}
                  onClick={() => void reviewDarkScope("continue")}
                >
                  対象として続行
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={submitting}
                  onClick={() => void reviewDarkScope("cancel")}
                >
                  登録を取り消す
                </button>
              </div>
            </Card>
          )}
          {value.darkBaseline && (
            <Card>
              <p className="eyebrow">DARK BASELINE SNAPSHOT</p>
              <h3>ダーク化前の比較ベースライン</h3>
              <p className="section-help">通常分析器や通常の好みの属性には対応させず、差分理解だけに使います。</p>
              <dl className="review-summary">
                {Object.entries(value.darkBaseline)
                  .filter(([key]) => key !== "id" && key !== "evidence" && key !== "uncertainties")
                  .map(([key, item]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(item) ? item.join("、") || "—" : String(item ?? "—")}</dd>
                    </div>
                  ))}
              </dl>
            </Card>
          )}
          {reanalyzableStatuses.has(value.entry.status) && (
            <button type="button" className="button button-secondary" onClick={onReanalyze}>
              入力を見直して再分析
            </button>
          )}
          {value.baseUnderstanding && (
            <Card>
              <p className="eyebrow">BASE CHARACTER UNDERSTANDING</p>
              <h3>既成キャラクターの基本像</h3>
              <p>{String(value.baseUnderstanding.summary.identity ?? "")}</p>
              <dl className="review-summary">
                {Object.entries(value.baseUnderstanding.summary)
                  .filter(([key]) => key !== "identity")
                  .map(([key, item]) => (
                    <div key={key}>
                      <dt>{understandingSummaryLabel(key)}</dt>
                      <dd>{reviewSummaryValue(item)}</dd>
                    </div>
                  ))}
              </dl>
              <h4>基本像の抽出属性</h4>
              {value.entry.status === "understanding_review" && (
                <p className="review-edit-guidance">
                  認識と違う項目は修正・削除でき、不足している属性は手動追加できます。保存した内容は基本像の確認結果として記録されます。
                </p>
              )}
              <div className="assertion-list">
                {value.baseUnderstanding.assertions.map((item) => (
                  <article key={item.id}>
                    <div className="assertion-card-header">
                      <div className="assertion-title">
                        <strong>{item.raw_label}</strong>
                        {item.status === "corrected" && <span className="user-corrected-badge">ユーザー修正</span>}
                      </div>
                      <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                    </div>
                    <p className="assertion-value">{item.value_text}</p>
                    <EvidenceList evidence={item.evidence} />
                    {value.entry.status === "understanding_review" && (
                      <AssertionReviewControls
                        item={item}
                        ontologyAttributes={value.ontologyAttributes}
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.baseUnderstanding?.id, input)}
                      />
                    )}
                  </article>
                ))}
                {value.entry.status === "understanding_review" && (
                  <AddAssertionControl
                    ontologyAttributes={value.ontologyAttributes}
                    disabled={submitting}
                    onMutate={(input) => mutateUnderstandingSnapshot(value.baseUnderstanding?.id, input)}
                  />
                )}
              </div>
            </Card>
          )}
          {value.understanding && (
            <Card>
              <p className="eyebrow">CHARACTER UNDERSTANDING</p>
              <h3>{value.baseUnderstanding ? "対象像・基本像からの差分" : "キャラクター像"}</h3>
              <p>{String(value.understanding.summary.identity ?? "")}</p>
              <dl className="review-summary">
                {Object.entries(value.understanding.summary)
                  .filter(([key]) => key !== "identity")
                  .map(([key, item]) => (
                    <div key={key}>
                      <dt>{understandingSummaryLabel(key)}</dt>
                      <dd>{reviewSummaryValue(item)}</dd>
                    </div>
                  ))}
              </dl>
              <h4>抽出属性</h4>
              {value.entry.status === "understanding_review" && (
                <p className="review-edit-guidance">
                  認識と違う項目は修正・削除でき、不足している属性は手動追加できます。保存した内容が次の好み分析に使われます。
                </p>
              )}
              <div className="assertion-list">
                {value.understanding.assertions.map((item) => (
                  <article key={item.id}>
                    <div className="assertion-card-header">
                      <div className="assertion-title">
                        <strong>{item.raw_label}</strong>
                        {item.status === "corrected" && <span className="user-corrected-badge">ユーザー修正</span>}
                      </div>
                      <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                    </div>
                    <p className="assertion-value">{item.value_text}</p>
                    <EvidenceList evidence={item.evidence} />
                    {value.entry.status === "understanding_review" && (
                      <AssertionReviewControls
                        item={item}
                        ontologyAttributes={value.ontologyAttributes}
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                      />
                    )}
                  </article>
                ))}
                {value.entry.status === "understanding_review" && (
                  <AddAssertionControl
                    ontologyAttributes={value.ontologyAttributes}
                    disabled={submitting}
                    onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                  />
                )}
              </div>
              {(value.understanding.deltas.length > 0 ||
                (value.baseUnderstanding && value.entry.status === "understanding_review")) && (
                <>
                  <h4>原典からどのように変わっているか</h4>
                  <p className="section-help">原典の設定と、この登録で指定されたキャラクター像を比較しています。</p>
                  <div className="customization-delta-list">
                    {value.understanding.deltas.map((item) => (
                      <CustomizationDeltaCard
                        key={item.id}
                        item={item}
                        targetName={value.entry.draft.characterName}
                        editable={value.entry.status === "understanding_review"}
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                      />
                    ))}
                    {value.entry.status === "understanding_review" && (
                      <AddDeltaControl
                        disabled={submitting}
                        onMutate={(input) => mutateUnderstandingSnapshot(value.understanding?.id, input)}
                      />
                    )}
                  </div>
                </>
              )}
              {value.darkTransformationDeltas.length > 0 && (
                <>
                  <h4>ダーク化前からの専用差分</h4>
                  <p className="section-help">
                    保持・増幅・抑圧・反転・消失・追加を、主体性と責任の情報から分離して保存しています。
                  </p>
                  <div className="customization-delta-list">
                    {value.darkTransformationDeltas.map((item) => (
                      <article key={item.id} className="dark-delta-card">
                        <div className="assertion-card-header">
                          <strong>
                            {item.operation}：{item.aspect}
                          </strong>
                          <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                        </div>
                        <p>
                          {item.before_value ?? "—"} → {item.after_value ?? "—"}
                        </p>
                        <small>
                          主体性: {String(item.detail.agencyOrigin ?? "unknown")} ／ 抵抗:{" "}
                          {String(item.detail.resistance ?? "unknown")} ／ 責任:{" "}
                          {String(item.detail.responsibility ?? "unknown")}
                        </small>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {value.entry.status === "understanding_review" && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={submitting}
                  onClick={() => confirm("understanding")}
                >
                  この理解を確認して好み分析へ
                </button>
              )}
            </Card>
          )}
          {value.preferenceAnalysis && (
            <Card>
              <p className="eyebrow">PREFERENCE CANDIDATES</p>
              <h3>この登録から読み取った「好き」</h3>
              {value.entry.status === "analysis_review" && (
                <p className="review-edit-guidance">
                  認識と違う候補は個別に削除できます。削除した候補はプロフィールへ反映されません。
                </p>
              )}
              {value.preferenceAnalysis.qualityContext?.refinementMode === "hypotheses" && (
                <Notice tone="info">ここにある候補は仮説です。自分に合う候補だけを残して確認してください。</Notice>
              )}
              {["analysis_review", "analyzing"].includes(value.entry.status) && (
                <details
                  className="quality-refinement"
                  open={
                    Boolean(value.preferenceAnalysis.hypothesisPreview) ||
                    value.preferenceAnalysis.qualityContext?.evidenceInsufficient
                  }
                >
                  <summary>追加質問・仮説候補を使う</summary>
                  <PreferenceRefinement
                    key={value.preferenceAnalysis.id}
                    domain={domain}
                    entryId={value.entry.id}
                    questions={value.preferenceAnalysis.uncertainties}
                    preview={value.preferenceAnalysis.hypothesisPreview ?? null}
                    analyzing={value.entry.status === "analyzing"}
                    onUpdated={async () => {
                      await detail.refetch();
                      await onUpdated();
                    }}
                  />
                </details>
              )}
              <div className="preference-attribute-list">
                {value.preferenceAnalysis.assertions.length === 0 &&
                  value.preferenceAnalysis.valueStances.length === 0 && (
                    <Notice tone="info">
                      この登録からは好みを特定できませんでした。これは正常な分析結果で、候補を追加せず確認できます。
                    </Notice>
                  )}
                {groupPreferenceAssertions(value.preferenceAnalysis.assertions).map((group) => (
                  <section className="preference-attribute-group" key={group.id}>
                    <header className="preference-attribute-header">
                      <h4>{group.label}</h4>
                      <small>惹かれ方 {group.items.length}件</small>
                    </header>
                    <div className="preference-channel-list">
                      {group.items.map((item) => {
                        const itemLabelDiffers =
                          normalizePreferenceLabel(item.raw_label) !== normalizePreferenceLabel(group.label);
                        return (
                          <article key={item.id} className={`preference-channel-item preference-${item.polarity}`}>
                            <div className="assertion-card-header">
                              <div className="preference-channel-title">
                                <strong>{responseChannelLabel(item.response_channel)}</strong>
                                <span className="preference-polarity">
                                  {item.polarity === "negative"
                                    ? "苦手・否定的"
                                    : item.polarity === "mixed"
                                      ? "好き嫌いが混在"
                                      : "好き・肯定的"}
                                </span>
                              </div>
                              <small className="confidence-pill">
                                登録内支持度 {Math.round(item.confidence * 100)}%
                              </small>
                            </div>
                            {itemLabelDiffers && (
                              <small className="preference-source-label">表現：{item.raw_label}</small>
                            )}
                            <small>
                              強さ {Math.round(item.strength * 100)}%・{explicitnessLabel(item.explicitness)}
                            </small>
                            <EvidenceList evidence={item.evidence} />
                            {value.entry.status === "analysis_review" && (
                              <div className="review-item-actions">
                                <PreferenceAssertionEditControl
                                  item={item}
                                  domain={domain}
                                  ontologyAttributes={value.ontologyAttributes}
                                  disabled={submitting}
                                  onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                                />
                                <button
                                  type="button"
                                  className="danger-link"
                                  disabled={submitting}
                                  onClick={() =>
                                    void rejectPreferenceItem(
                                      value.preferenceAnalysis?.id ?? "",
                                      item.id,
                                      `${group.label}／${responseChannelLabel(item.response_channel)}`,
                                    )
                                  }
                                >
                                  削除
                                </button>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {value.entry.status === "analysis_review" && (
                  <AddPreferenceAssertionControl
                    domain={domain}
                    ontologyAttributes={value.ontologyAttributes}
                    disabled={submitting}
                    onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                  />
                )}
              </div>
              {value.preferenceAnalysis.valueStances.length > 0 && (
                <>
                  <h4>価値スタンス</h4>
                  <div className="assertion-list">
                    {value.preferenceAnalysis.valueStances.map((item) => (
                      <article key={item.id}>
                        <div className="assertion-card-header">
                          <strong>{item.target_ref}</strong>
                          <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
                        </div>
                        <small>
                          対象の価値傾向：{valueOrientationLabel(item.orientation)} ／ あなたの捉え方：
                          {valueStanceLabel(item.stance)}
                        </small>
                        <EvidenceList evidence={item.evidence} />
                        {value.entry.status === "analysis_review" && (
                          <div className="review-item-actions">
                            <ValueStanceEditControl
                              item={item}
                              disabled={submitting}
                              onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                            />
                            <button
                              type="button"
                              className="danger-link"
                              disabled={submitting}
                              onClick={() =>
                                void rejectPreferenceItem(value.preferenceAnalysis?.id ?? "", item.id, item.target_ref)
                              }
                            >
                              削除
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
              {value.entry.status === "analysis_review" && (
                <AddValueStanceControl
                  disabled={submitting}
                  onMutate={(input) => mutatePreference(value.preferenceAnalysis?.id ?? "", input)}
                />
              )}
              {value.entry.status === "analysis_review" && (
                <>
                  <Notice tone="info">確認後に累積プロフィールへ反映します。</Notice>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={submitting}
                    onClick={() => confirm("preference")}
                  >
                    すべて確認してプロフィールへ反映
                  </button>
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </Modal>
  );
}
