import { useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { DarkResponseChannel } from "../../../shared/dark-response-channels";
import type { ResponseChannel } from "../../../shared/response-channels";
import { Modal, Notice } from "../../components/Ui";
import { DarkContextFields } from "./DarkContextFields";
import { emptyForm, type FormState } from "./form-state";
import { ResponseChannelPicker } from "./ResponseChannelPicker";
import { useEntrySubmission } from "./use-entry-submission";

export function EntryFormModal({
  domain,
  onClose,
  onCreated,
}: {
  domain: AnalysisDomain;
  onClose(): void;
  onCreated(): void;
}) {
  const [form, setForm] = useState<FormState>(() => emptyForm(domain));
  const {
    submitting,
    progressLabel,
    error,
    candidates,
    selectedIdentityId,
    selectIdentity,
    invalidateCandidates,
    submit,
  } = useEntrySubmission({ domain, form, onCreated });
  const requestClose = () => {
    const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(emptyForm(domain));
    if (
      hasUnsavedChanges &&
      !window.confirm("入力途中の内容があります。閉じると入力内容は失われます。閉じてもよろしいですか？")
    ) {
      return;
    }
    onClose();
  };
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (["registrationType", "workTitle", "baseCharacterName", "characterName", "mediaType"].includes(key)) {
      invalidateCandidates();
    }
  };
  const toggleResponseChannel = (value: ResponseChannel | DarkResponseChannel, selected: boolean) =>
    update(
      "responseChannels",
      selected
        ? form.responseChannels.includes(value)
          ? form.responseChannels
          : [...form.responseChannels, value]
        : form.responseChannels.filter((item) => item !== value),
    );

  return (
    <Modal title={domain === "dark" ? "ダークキャラクターを登録" : "キャラクターを登録"} onClose={requestClose} wide>
      <form className="entry-form" onSubmit={submit} aria-busy={submitting}>
        <fieldset className="entry-form-fields" disabled={submitting} aria-label="登録内容">
          <fieldset className="segmented">
            <legend>登録方法</legend>
            {(["existing", "customized_existing", "original"] as const).map((type) => (
              <button
                type="button"
                key={type}
                className={form.registrationType === type ? "active" : ""}
                onClick={() => update("registrationType", type)}
              >
                {type === "existing" ? "既成" : type === "customized_existing" ? "既成（カスタム）" : "オリジナル"}
              </button>
            ))}
          </fieldset>
          <div className="form-grid">
            {form.registrationType !== "original" && (
              <label>
                <span>
                  作品名 <b>必須</b>
                </span>
                <input
                  required
                  maxLength={200}
                  value={form.workTitle}
                  onChange={(event) => update("workTitle", event.target.value)}
                />
              </label>
            )}
            {form.registrationType === "customized_existing" && (
              <label>
                <span>
                  既成キャラクター名 <b>必須</b>
                </span>
                <input
                  required
                  maxLength={200}
                  value={form.baseCharacterName}
                  onChange={(event) => update("baseCharacterName", event.target.value)}
                />
                <small>元キャラクターを特定し、「既成キャラクターの基本像」を調べるための名前です。</small>
              </label>
            )}
            <label>
              <span>
                キャラクター名 <b>必須</b>
              </span>
              <input
                required
                maxLength={200}
                value={form.characterName}
                onChange={(event) => update("characterName", event.target.value)}
              />
              {form.registrationType === "customized_existing" && (
                <small>カスタム後のキャラクター名です。一覧や解析画面ではこちらを表示します。</small>
              )}
            </label>
            {form.registrationType !== "original" && (
              <label>
                <span>媒体・版</span>
                <input
                  maxLength={100}
                  value={form.mediaType}
                  onChange={(event) => update("mediaType", event.target.value)}
                  placeholder="アニメ版、ゲーム版など"
                />
              </label>
            )}
            {form.registrationType === "original" && (
              <label className="full">
                <span>
                  キャラクター基本情報 <b>必須</b>
                </span>
                <textarea
                  required
                  rows={7}
                  maxLength={20000}
                  value={form.characterBasicInfo}
                  onChange={(event) => update("characterBasicInfo", event.target.value)}
                  placeholder="性格、価値観、目的、行動、他者との関係、物語上の役割など"
                />
                <small>このオリジナルキャラクターがどのような人物か分かる、基本的な設定を入力してください。</small>
              </label>
            )}
            {domain === "dark" && <DarkContextFields form={form} update={update} />}
            <label className="full">
              <span>特に好きな時期・場面・状態（任意）</span>
              <input
                maxLength={2000}
                value={form.preferenceContext}
                onChange={(event) => update("preferenceContext", event.target.value)}
                placeholder="例：記憶を失っていた時期、第7話で別人格が現れている間"
              />
              <small>キャラクター全体ではなく、特定の時期や場面、状態に限って好きな場合に入力してください。</small>
            </label>
            {form.registrationType === "customized_existing" && (
              <>
                <label>
                  <span>カスタムの種類</span>
                  <select
                    value={form.representationType}
                    onChange={(event) =>
                      update("representationType", event.target.value as FormState["representationType"])
                    }
                  >
                    <option value="user_interpretation">独自解釈</option>
                    <option value="facet">特定の側面</option>
                    <option value="scene_state">特定の場面・状態</option>
                    <option value="transformative">二次創作</option>
                    <option value="alternate_setting">別設定</option>
                  </select>
                </label>
                <label className="full">
                  <span>
                    基本像からどう違うか <b>必須</b>
                  </span>
                  <textarea
                    required
                    rows={4}
                    maxLength={8000}
                    value={form.customizationDescription}
                    onChange={(event) => update("customizationDescription", event.target.value)}
                  />
                </label>
              </>
            )}
            <label className="full">
              <span>解析に加えたい参考情報（任意）</span>
              <textarea
                rows={7}
                maxLength={20000}
                value={form.referenceMaterial}
                onChange={(event) => update("referenceMaterial", event.target.value)}
                placeholder={
                  form.registrationType === "customized_existing"
                    ? "例：改変前の公式設定や人物像について、解析に加えたい情報"
                    : form.registrationType === "original"
                      ? "例：基本情報とは別に参照させたい設定メモや補足資料"
                      : "例：公式プロフィールや作中描写について、解析に加えたい情報"
                }
              />
              <small>
                {form.registrationType === "original"
                  ? "基本情報に加えて参照させたい資料がある場合に入力してください。"
                  : "未入力でも、作品名とキャラクター名をもとにシステムが基本情報を調べます。資料がある場合は補足として入力してください。"}
              </small>
            </label>
            <label className="full">
              <span>あなた自身のキャラクター解釈</span>
              <textarea
                rows={3}
                maxLength={4000}
                value={form.userCharacterView}
                onChange={(event) => update("userCharacterView", event.target.value)}
              />
            </label>
            <label className="full">
              <span>好きな理由</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={form.likedReasons}
                onChange={(event) => update("likedReasons", event.target.value)}
                placeholder="例：言葉遣い、考え方、人間関係、特定の場面での振る舞い"
              />
            </label>
            <label className="full">
              <span>苦手な要素・このキャラで好きではない点</span>
              <textarea
                rows={3}
                maxLength={4000}
                value={form.dislikedReasons}
                onChange={(event) => update("dislikedReasons", event.target.value)}
              />
            </label>
            <ResponseChannelPicker domain={domain} selected={form.responseChannels} onChange={toggleResponseChannel} />
            <label className="full">
              <span>善悪・価値観について残したいニュアンス</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={form.valueStanceNote}
                onChange={(event) => update("valueStanceNote", event.target.value)}
                placeholder="例：このキャラクターの価値観や行動を、好きな理由としてどう捉えているか"
              />
            </label>
          </div>
          {form.registrationType !== "original" && candidates && candidates.length > 0 && (
            <fieldset className="identity-resolution">
              <legend>同じ作品・キャラクターの登録候補</legend>
              <p>
                同一人物なら既存の同一人物情報を再利用します。今回の解釈・表現はどちらを選んでも新しく保存されます。いずれかを選択して開始ボタンを押してください。
              </p>
              {candidates.map((candidate) => (
                <label className="check-row" key={candidate.characterIdentityId}>
                  <input
                    type="radio"
                    name="identity-resolution"
                    checked={selectedIdentityId === candidate.characterIdentityId}
                    onChange={() => selectIdentity(candidate.characterIdentityId)}
                  />
                  <span>
                    既存の同一人物情報を再利用：{candidate.workTitle} / {candidate.characterName}
                  </span>
                </label>
              ))}
              <label className="check-row">
                <input
                  type="radio"
                  name="identity-resolution"
                  checked={selectedIdentityId === "new"}
                  onChange={() => selectIdentity("new")}
                />
                <span>同名だが別物として新規登録</span>
              </label>
            </fieldset>
          )}
        </fieldset>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="button button-ghost" onClick={requestClose}>
            キャンセル
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {progressLabel ?? "保存して理解抽出を開始"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
