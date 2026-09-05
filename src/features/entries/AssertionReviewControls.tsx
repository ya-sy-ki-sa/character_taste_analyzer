import { type FormEvent, useState } from "react";
import type { CharacterAssertionDetail } from "../../../shared/contracts/entry-review";
import type { ReviewMutationHandler } from "./review-types";

export function AssertionReviewControls({
  item,
  ontologyAttributes,
  disabled,
  onMutate,
}: {
  item: CharacterAssertionDetail;
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: ReviewMutationHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [rawLabel, setRawLabel] = useState(item.raw_label);
  const [valueText, setValueText] = useState(item.value_text);
  const [attributeStableKey, setAttributeStableKey] = useState(item.stable_key ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onMutate({
      action: "update_assertion",
      targetId: item.id,
      rawLabel,
      valueText,
      attributeStableKey: attributeStableKey || null,
    });
    if (saved) setEditing(false);
  }
  if (editing)
    return (
      <form className="review-edit-form" onSubmit={submit}>
        <label>
          <span>Ontology属性（このラボ内だけ）</span>
          <select value={attributeStableKey} onChange={(event) => setAttributeStableKey(event.target.value)}>
            <option value="">未対応のまま保存</option>
            {ontologyAttributes.map((attribute) => (
              <option key={attribute.stableKey} value={attribute.stableKey}>
                {attribute.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>属性名</span>
          <input value={rawLabel} onChange={(event) => setRawLabel(event.target.value)} maxLength={200} required />
        </label>
        <label>
          <span>内容</span>
          <textarea
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
            maxLength={2000}
            rows={3}
            required
          />
        </label>
        <div className="review-edit-actions">
          <button type="button" className="button button-ghost" onClick={() => setEditing(false)} disabled={disabled}>
            キャンセル
          </button>
          <button type="submit" className="button button-primary" disabled={disabled}>
            修正を保存
          </button>
        </div>
      </form>
    );
  return (
    <div className="review-item-actions">
      <button type="button" onClick={() => setEditing(true)} disabled={disabled}>
        修正
      </button>
      <button
        type="button"
        className="danger-link"
        disabled={disabled}
        onClick={() => {
          if (window.confirm(`「${item.raw_label}」を解析結果から削除しますか？`))
            void onMutate({ action: "delete_assertion", targetId: item.id });
        }}
      >
        削除
      </button>
    </div>
  );
}

export function AddAssertionControl({
  ontologyAttributes,
  disabled,
  onMutate,
}: {
  ontologyAttributes: Array<{ stableKey: string; label: string }>;
  disabled: boolean;
  onMutate: ReviewMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  const [rawLabel, setRawLabel] = useState("");
  const [valueText, setValueText] = useState("");
  const [attributeStableKey, setAttributeStableKey] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onMutate({
      action: "add_assertion",
      rawLabel,
      valueText,
      attributeStableKey: attributeStableKey || null,
    });
    if (!saved) return;
    setRawLabel("");
    setValueText("");
    setAttributeStableKey("");
    setOpen(false);
  }
  if (!open)
    return (
      <button type="button" className="manual-add-button" onClick={() => setOpen(true)} disabled={disabled}>
        ＋ 属性を手動追加
      </button>
    );
  return (
    <form className="review-edit-form manual-add-form" onSubmit={submit}>
      <strong>属性を手動追加</strong>
      <label>
        <span>Ontology属性（このラボ内だけ）</span>
        <select value={attributeStableKey} onChange={(event) => setAttributeStableKey(event.target.value)}>
          <option value="">未対応のまま保存</option>
          {ontologyAttributes.map((attribute) => (
            <option key={attribute.stableKey} value={attribute.stableKey}>
              {attribute.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>属性名</span>
        <input value={rawLabel} onChange={(event) => setRawLabel(event.target.value)} maxLength={200} required />
      </label>
      <label>
        <span>内容</span>
        <textarea
          value={valueText}
          onChange={(event) => setValueText(event.target.value)}
          maxLength={2000}
          rows={3}
          required
        />
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={() => setOpen(false)} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          追加する
        </button>
      </div>
    </form>
  );
}
