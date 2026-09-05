import { type FormEvent, useState } from "react";
import { valueOrientationLabel, valueStanceLabel } from "../../../shared/value-stance-labels";
import type { PreferenceMutationHandler } from "./review-types";

export const orientationOptions = [
  "evil",
  "immoral",
  "indifferent_to_good",
  "transgressive",
  "self_defined",
  "good",
  "mixed",
] as const;

export const stanceOptions = ["affirm", "accept", "indifferent", "ambivalent", "reject", "unspecified"] as const;

export function ValueStanceForm({
  initial,
  disabled,
  onCancel,
  onMutate,
}: {
  initial?: { id: string; target_ref: string; stance: string; orientation: string };
  disabled: boolean;
  onCancel(): void;
  onMutate: PreferenceMutationHandler;
}) {
  const [targetRef, setTargetRef] = useState(initial?.target_ref ?? "");
  const [stance, setStance] = useState<(typeof stanceOptions)[number]>(
    stanceOptions.includes(initial?.stance as (typeof stanceOptions)[number])
      ? (initial?.stance as (typeof stanceOptions)[number])
      : "accept",
  );
  const [orientation, setOrientation] = useState<(typeof orientationOptions)[number]>(
    orientationOptions.includes(initial?.orientation as (typeof orientationOptions)[number])
      ? (initial?.orientation as (typeof orientationOptions)[number])
      : "mixed",
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = initial
      ? await onMutate({ action: "update_value_stance", targetId: initial.id, targetRef, stance, orientation })
      : await onMutate({ action: "add_value_stance", targetRef, stance, orientation });
    if (saved) onCancel();
  }
  return (
    <form className="review-edit-form manual-add-form" onSubmit={submit}>
      <label>
        <span>対象の価値・行為・結末</span>
        <input required maxLength={500} value={targetRef} onChange={(event) => setTargetRef(event.target.value)} />
      </label>
      <label>
        <span>価値傾向</span>
        <select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}>
          {orientationOptions.map((item) => (
            <option key={item} value={item}>
              {valueOrientationLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>あなたの捉え方</span>
        <select value={stance} onChange={(event) => setStance(event.target.value as typeof stance)}>
          {stanceOptions.map((item) => (
            <option key={item} value={item}>
              {valueStanceLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <div className="review-edit-actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={disabled}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={disabled}>
          保存
        </button>
      </div>
    </form>
  );
}

export function ValueStanceEditControl(props: {
  item: { id: string; target_ref: string; stance: string; orientation: string };
  disabled: boolean;
  onMutate: PreferenceMutationHandler;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <ValueStanceForm
      initial={props.item}
      disabled={props.disabled}
      onCancel={() => setOpen(false)}
      onMutate={props.onMutate}
    />
  ) : (
    <button type="button" disabled={props.disabled} onClick={() => setOpen(true)}>
      編集
    </button>
  );
}

export function AddValueStanceControl(props: { disabled: boolean; onMutate: PreferenceMutationHandler }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <ValueStanceForm disabled={props.disabled} onCancel={() => setOpen(false)} onMutate={props.onMutate} />
  ) : (
    <button type="button" className="manual-add-button" disabled={props.disabled} onClick={() => setOpen(true)}>
      ＋ 価値スタンスを手動追加
    </button>
  );
}
