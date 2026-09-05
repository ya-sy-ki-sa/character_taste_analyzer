import { type FormEvent, useState } from "react";
import type { CustomizationDeltaDetail } from "../../../shared/contracts/entry-review";
import type { ReviewMutationHandler } from "./review-types";

export const deltaOperationLabels: Record<string, { label: string; description: string }> = {
  add: { label: "新しく追加された設定", description: "原典にはない設定が追加されています。" },
  modify: { label: "内容が変更された設定", description: "原典の設定が別の内容に変わっています。" },
  remove: { label: "取り除かれた設定", description: "原典にある設定が、このキャラクター像では適用されません。" },
  invert: { label: "反対になった設定", description: "原典とは反対の性質・立場へ変更されています。" },
  narrow_scope: { label: "範囲が限定された設定", description: "原典の設定が特定の場面や状態だけに限定されています。" },
  emphasize: { label: "より強調された設定", description: "原典にもある性質が、より強く表現されています。" },
  inherit: { label: "原典から引き継いだ設定", description: "原典と同じ設定が維持されています。" },
  unspecified: { label: "その他の変更", description: "登録内容から読み取った原典との差分です。" },
};

export const deltaOperationOptions = [
  { value: "add", label: "新しい設定を追加" },
  { value: "modify", label: "原典の設定を変更" },
  { value: "remove", label: "原典の設定を適用しない" },
  { value: "invert", label: "原典と反対の設定にする" },
  { value: "narrow_scope", label: "適用範囲を限定" },
  { value: "emphasize", label: "原典の設定を強調" },
  { value: "inherit", label: "原典の設定を引き継ぐ" },
  { value: "unspecified", label: "その他の変更" },
] as const;

export type DeltaOperation = (typeof deltaOperationOptions)[number]["value"];

export function DeltaReviewForm({
  initial,
  targetId,
  disabled,
  onMutate,
  onCancel,
}: {
  initial?: CustomizationDeltaDetail;
  targetId?: string;
  disabled: boolean;
  onMutate: ReviewMutationHandler;
  onCancel(): void;
}) {
  const [operation, setOperation] = useState<DeltaOperation>((initial?.operation as DeltaOperation) ?? "add");
  const [beforeValue, setBeforeValue] = useState(initial?.before_value ?? "");
  const [afterValue, setAfterValue] = useState(initial?.after_value ?? "");
  const [reasonText, setReasonText] = useState(initial?.reason_text ?? "");
  const options = targetId
    ? deltaOperationOptions
    : deltaOperationOptions.filter((item) => item.value !== "remove" && item.value !== "inherit");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = {
      operation,
      beforeValue: operation === "add" ? null : beforeValue.trim() || null,
      afterValue: operation === "remove" ? null : afterValue.trim() || null,
      reasonText: reasonText.trim() || null,
    };
    const saved = await onMutate(
      targetId ? { action: "update_delta", targetId, ...fields } : { action: "add_delta", ...fields },
    );
    if (saved) onCancel();
  }
  const requiresBefore = ["modify", "remove", "invert"].includes(operation);
  const requiresAfter = operation !== "remove";
  return (
    <form className="review-edit-form delta-edit-form" onSubmit={submit}>
      <strong>{targetId ? "差分を修正" : "差分を手動追加"}</strong>
      <label>
        <span>変更の種類</span>
        <select
          value={operation}
          onChange={(event) => {
            const next = event.target.value as DeltaOperation;
            setOperation(next);
            if (next === "add") setBeforeValue("");
            if (next === "remove") setAfterValue("");
          }}
        >
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {operation !== "add" && (
        <label>
          <span>原典の設定</span>
          <textarea
            value={beforeValue}
            onChange={(event) => setBeforeValue(event.target.value)}
            maxLength={2000}
            rows={2}
            required={requiresBefore}
          />
        </label>
      )}
      {operation !== "remove" && (
        <label>
          <span>変更後の設定</span>
          <textarea
            value={afterValue}
            onChange={(event) => setAfterValue(event.target.value)}
            maxLength={2000}
            rows={2}
            required={requiresAfter}
          />
        </label>
      )}
      <label>
        <span>補足・判定理由（任意）</span>
        <textarea
          value={reasonText}
          onChange={(event) => setReasonText(event.target.value)}
          maxLength={2000}
          rows={2}
        />
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          {targetId ? "修正を保存" : "追加する"}
        </button>
      </div>
    </form>
  );
}

export function AddDeltaControl({ disabled, onMutate }: { disabled: boolean; onMutate: ReviewMutationHandler }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="manual-add-button" onClick={() => setOpen(true)} disabled={disabled}>
        ＋ 差分を手動追加
      </button>
    );
  return <DeltaReviewForm disabled={disabled} onMutate={onMutate} onCancel={() => setOpen(false)} />;
}

export function CustomizationDeltaCard({
  item,
  targetName,
  editable = false,
  disabled = false,
  onMutate,
}: {
  item: CustomizationDeltaDetail;
  targetName: string;
  editable?: boolean;
  disabled?: boolean;
  onMutate?: ReviewMutationHandler;
}) {
  const [editing, setEditing] = useState(false);
  const operation = deltaOperationLabels[item.operation] ?? {
    label: "設定の変更",
    description: "登録内容から読み取った原典との差分です。",
  };
  return (
    <article className={`customization-delta delta-${item.operation}`}>
      <header className="customization-delta-header">
        <div>
          <div className="assertion-title">
            <strong>{operation.label}</strong>
            {item.status === "corrected" && <span className="user-corrected-badge">ユーザー修正</span>}
          </div>
          <p>{operation.description}</p>
        </div>
        <small className="confidence-pill">登録内支持度 {Math.round(item.confidence * 100)}%</small>
      </header>
      <div className="customization-comparison">
        <section>
          <span>原典の設定</span>
          <p>{item.before_value ?? "該当する設定なし"}</p>
        </section>
        <span className="customization-arrow" aria-hidden="true">
          →
        </span>
        <section className="customization-target">
          <span>{targetName}の設定</span>
          <p>{item.after_value ?? "このキャラクター像では適用しない"}</p>
        </section>
      </div>
      {item.reason_text && (
        <p className="customization-reason">
          <strong>判定理由</strong>
          <span>{item.reason_text}</span>
        </p>
      )}
      {editable &&
        onMutate &&
        (editing ? (
          <DeltaReviewForm
            initial={item}
            targetId={item.id}
            disabled={disabled}
            onMutate={onMutate}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="review-item-actions">
            <button type="button" onClick={() => setEditing(true)} disabled={disabled}>
              修正
            </button>
            <button
              type="button"
              className="danger-link"
              disabled={disabled}
              onClick={() => {
                if (window.confirm("この差分を解析結果から削除しますか？"))
                  void onMutate({ action: "delete_delta", targetId: item.id });
              }}
            >
              削除
            </button>
          </div>
        ))}
    </article>
  );
}
