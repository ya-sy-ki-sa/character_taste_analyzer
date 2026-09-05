import { useState } from "react";
import type { SessionUser } from "../../shared/membership";
import { Card, Modal, Notice, PageHeading } from "../components/Ui";
import { accountApi } from "../features/account/api";
import { downloadExport } from "../features/account/export";

export function SettingsPage({ user }: { user?: SessionUser }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT & PRIVACY"
        title="設定"
        description="データの持ち出し、プライバシー、アカウント削除を管理します。"
      />
      {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
      <div className="settings-grid">
        <Card>
          <div className="settings-icon">⇩</div>
          <div>
            <h2>データをエクスポート</h2>
            <p>
              全入力・変更履歴・分析・根拠・プロフィール・生成・処理履歴を、非同期でJSON形式のファイルへまとめます。認証情報は含みません。
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                try {
                  await downloadExport();
                  setNotice({
                    tone: "success",
                    message: "エクスポートを作成し、ダウンロードしました。ファイルは24時間で失効します。",
                  });
                } catch (error) {
                  setNotice({
                    tone: "danger",
                    message: error instanceof Error ? error.message : "エクスポートに失敗しました",
                  });
                }
              }}
            >
              JSONをダウンロード
            </button>
          </div>
        </Card>
        <Card>
          <div className="settings-icon">◌</div>
          <div>
            <h2>プライバシー</h2>
            <p>
              公開されるのはユーザー名と公開IDだけです。入力内容は分析・生成のためCloudflare Workers
              AIまたはOpenAIへ送信されます。
            </p>
            <ul>
              <li>既成キャラクターではWikipedia、Wikidata、OpenAI Web Search、モデル知識を補助情報として利用します</li>
              <li>根拠には出典と検証状態を保存し、原文へ移動できるのは原文照合済みの引用だけです</li>
              <li>モデル知識・出典だけ確認できた根拠は、検証済み引用と区別して表示します</li>
              <li>資格情報やユーザー名をLLMへ送りません</li>
              <li>プロンプト・応答本文をアプリログへ残しません</li>
            </ul>
          </div>
        </Card>
        <Card className="danger-card">
          <div className="settings-icon">×</div>
          <div>
            <h2>アカウントを削除</h2>
            <p>入力、分析、生成、セッションをすべて削除します。この操作は取り消せません。</p>
            <button type="button" className="button button-danger" onClick={() => setDeleteOpen(true)}>
              アカウントを削除
            </button>
          </div>
        </Card>
      </div>
      <Card className="version-card">
        <dl>
          <div>
            <dt>ユーザー</dt>
            <dd>
              <strong>{user?.username}</strong>
            </dd>
          </div>
          <div>
            <dt>公開ID</dt>
            <dd>
              <code>{user?.id}</code>
            </dd>
          </div>
          <div>
            <dt>アプリ</dt>
            <dd>
              <strong>キャラ好みラボ</strong>
              <small>v0.1</small>
            </dd>
          </div>
        </dl>
      </Card>
      {deleteOpen && user && <DeleteModal user={user} onClose={() => setDeleteOpen(false)} />}
    </>
  );
}

function DeleteModal({ user, onClose }: { user: SessionUser; onClose(): void }) {
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    setSubmitting(true);
    try {
      await accountApi.delete({ usernameConfirmation: confirmation });
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "削除できませんでした");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="アカウントを完全に削除" onClose={onClose}>
      <div className="stack-form">
        <Notice tone="danger">
          <strong>この操作は取り消せません。</strong>
          <br />
          すべての入力、分析、生成結果が削除されます。
        </Notice>
        <label>
          <span>確認のため「{user.username}」と入力</span>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="button-row">
          <button type="button" className="button button-ghost" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={confirmation !== user.username || submitting}
            onClick={remove}
          >
            {submitting ? "削除中…" : "完全に削除"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
