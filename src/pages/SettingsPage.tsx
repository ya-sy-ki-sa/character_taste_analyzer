import { type FormEvent, useState } from "react";
import type { SessionUser } from "../App";
import { api, downloadExport } from "../api";
import { Card, Modal, Notice, PageHeading } from "../components/Ui";

export function SettingsPage({ user }: { user?: SessionUser }) {
  const [rotationOpen, setRotationOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string }>();

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT & PRIVACY"
        title="設定"
        description="アクセスキー、データの持ち出し、アカウント削除を管理します。"
      />
      {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
      <div className="settings-grid">
        <Card>
          <div className="settings-icon">⌁</div>
          <div>
            <h2>アクセスキー</h2>
            <p>現在のキーを知っている場合だけ、新しいUUIDキーへ変更できます。変更すると全端末からログアウトします。</p>
            <button type="button" className="button button-secondary" onClick={() => setRotationOpen(true)}>
              アクセスキーを変更
            </button>
          </div>
        </Card>
        <Card>
          <div className="settings-icon">⇩</div>
          <div>
            <h2>データをエクスポート</h2>
            <p>入力、分析プロフィール、生成履歴をJSON形式でダウンロードします。認証情報は含みません。</p>
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                try {
                  await downloadExport();
                  setNotice({ tone: "success", message: "エクスポートを開始しました。" });
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
              <li>モデルの作品知識や外部検索を分析根拠にしません</li>
              <li>資格情報やユーザー名をLLMへ送りません</li>
              <li>プロンプト・応答本文をアプリログへ残しません</li>
            </ul>
          </div>
        </Card>
        <Card className="danger-card">
          <div className="settings-icon">×</div>
          <div>
            <h2>アカウントを削除</h2>
            <p>入力、分析、生成、フィードバック、セッションをすべて削除します。この操作は取り消せません。</p>
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
              <strong>キャラ嗜好ラボ</strong>
              <small>v0.1</small>
            </dd>
          </div>
        </dl>
      </Card>
      {rotationOpen && <RotationModal onClose={() => setRotationOpen(false)} />}
      {deleteOpen && user && <DeleteModal user={user} onClose={() => setDeleteOpen(false)} />}
    </>
  );
}

function RotationModal({ onClose }: { onClose(): void }) {
  const [currentAccessKey, setCurrentAccessKey] = useState("");
  const [nextKey, setNextKey] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function rotate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api<{ accessKey: string }>("/api/v1/account/key-rotation", {
        method: "POST",
        body: JSON.stringify({ currentAccessKey }),
      });
      setNextKey(result.accessKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "変更できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="アクセスキーを変更" onClose={onClose}>
      {nextKey ? (
        <div className="stack-form">
          <Notice tone="warning">この新しいキーは一度だけ表示されます。</Notice>
          <div className="credential-box">
            <small>NEW UUID ACCESS KEY</small>
            <code>{nextKey}</code>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(nextKey);
              setSaved(true);
            }}
          >
            {saved ? "コピーしました" : "キーをコピー"}
          </button>
          <label className="check-row">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            <span>新しいキーを安全な場所に保存しました</span>
          </label>
          <button
            type="button"
            className="button button-primary"
            disabled={!saved}
            onClick={() => {
              window.location.href = "/";
            }}
          >
            ログイン画面へ
          </button>
        </div>
      ) : (
        <form className="stack-form" onSubmit={rotate}>
          <p className="muted">本人確認のため、現在のアクセスキーを入力してください。</p>
          <label>
            <span>現在のアクセスキー</span>
            <input
              value={currentAccessKey}
              onChange={(event) => setCurrentAccessKey(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? "変更中…" : "新しいキーを発行"}
          </button>
        </form>
      )}
    </Modal>
  );
}

function DeleteModal({ user, onClose }: { user: SessionUser; onClose(): void }) {
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    setSubmitting(true);
    try {
      await api("/api/v1/account", { method: "DELETE" });
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
