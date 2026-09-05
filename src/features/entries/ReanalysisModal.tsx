import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AnalysisDomain } from "../../../shared/analysis-domain";
import type { AnyEntryDraft } from "../../../shared/contracts/entries";
import type { DarkResponseChannel } from "../../../shared/dark-response-channels";
import type { ResponseChannel } from "../../../shared/response-channels";
import { Modal, Notice, Spinner } from "../../components/Ui";
import { entriesApi } from "./api";
import { DarkContextFields } from "./DarkContextFields";
import { type FormState, formStateFromDraft } from "./form-state";
import { ResponseChannelPicker } from "./ResponseChannelPicker";
import { useEntrySubmission } from "./use-entry-submission";

export function ReanalysisModal({
  domain,
  entryId,
  onClose,
  onCreated,
}: {
  domain: AnalysisDomain;
  entryId: string;
  onClose(): void;
  onCreated(): void;
}) {
  const detail = useQuery({
    queryKey: ["entry", domain, entryId],
    queryFn: () => entriesApi.review(domain, entryId),
  });
  return (
    <Modal title="入力を見直して再分析" onClose={onClose} wide>
      {detail.isPending && <Spinner label="現在の入力を読み込んでいます" />}
      {detail.isError && <Notice tone="danger">現在の入力を読み込めませんでした。</Notice>}
      {detail.data && (
        <ReanalysisForm
          domain={domain}
          entryId={entryId}
          draft={detail.data.entry.draft}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Modal>
  );
}

export function ReanalysisForm({
  entryId,
  domain,
  draft,
  onClose,
  onCreated,
}: {
  entryId: string;
  domain: AnalysisDomain;
  draft: AnyEntryDraft;
  onClose(): void;
  onCreated(): void;
}) {
  const [form, setForm] = useState<FormState>(() => formStateFromDraft(draft));
  const {
    submitting,
    progressLabel,
    error,
    candidates,
    selectedIdentityId,
    selectIdentity,
    invalidateCandidates,
    requiresIdentityResolution,
    submit,
  } = useEntrySubmission({ domain, form, reanalysis: { entryId, draft }, onCreated });
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (["workTitle", "baseCharacterName", "characterName", "mediaType"].includes(key)) {
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
    <form className="entry-form" onSubmit={submit} aria-busy={submitting}>
      <Notice tone="warning">
        現在の解析履歴は残ります。再分析を始めると、新しい結果を確認するまでこの登録は累積プロフィールの集計対象外になります。
      </Notice>
      <fieldset className="entry-form-fields" disabled={submitting} aria-label="再分析する入力">
        <fieldset className="segmented" disabled>
          <legend>登録方法（変更できません）</legend>
          <button type="button" className="active">
            {form.registrationType === "existing"
              ? "既成"
              : form.registrationType === "customized_existing"
                ? "既成（カスタム）"
                : "オリジナル"}
          </button>
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
              <small>元キャラクターを特定し、「既成キャラクターの基本像」を再分析するための名前です。</small>
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
              <small>カスタム後の表示名です。一覧や解析画面ではこちらを表示します。</small>
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
              />
            </label>
          )}
          {domain === "dark" && <DarkContextFields form={form} update={update} />}
          <label className="full">
            <span>特に好きな時期・場面・状態（任意）</span>
            <input
              maxLength={2000}
              value={form.preferenceContext}
              onChange={(event) => update("preferenceContext", event.target.value)}
            />
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
            />
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
              rows={5}
              maxLength={4000}
              value={form.likedReasons}
              onChange={(event) => update("likedReasons", event.target.value)}
              placeholder="思い出した理由や、分析結果へ反映したい具体的な点を入力してください"
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
            />
          </label>
        </div>
        {requiresIdentityResolution && candidates && candidates.length > 0 && (
          <fieldset className="identity-resolution">
            <legend>変更後の作品・キャラクターに一致する候補</legend>
            <p>
              同一人物なら既存の同一人物情報を再利用します。別物の場合は新規として扱います。いずれかを選択して開始ボタンを押してください。
            </p>
            {candidates.map((candidate) => (
              <label className="check-row" key={candidate.characterIdentityId}>
                <input
                  type="radio"
                  name="reanalysis-identity-resolution"
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
                name="reanalysis-identity-resolution"
                checked={selectedIdentityId === "new"}
                onChange={() => selectIdentity("new")}
              />
              <span>別物として新規登録</span>
            </label>
          </fieldset>
        )}
      </fieldset>
      <small>入力を変更せず、現在の内容でもう一度分析することもできます。</small>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="modal-actions">
        <button type="button" className="button button-ghost" onClick={onClose}>
          キャンセル
        </button>
        <button type="submit" className="button button-primary" disabled={submitting}>
          {progressLabel ?? "入力を保存して再分析"}
        </button>
      </div>
    </form>
  );
}
