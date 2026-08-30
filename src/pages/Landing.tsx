import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, idempotencyKey, setCsrfToken } from "../api";
import { Turnstile } from "../components/Turnstile";
import { Brand, Modal, Notice, Spinner } from "../components/Ui";

type PublicUser = { id: string; username: string };
type SessionUser = { id: string; username: string };

export function Landing({ onLogin }: { onLogin(user: SessionUser): void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<PublicUser>();
  const [showCreate, setShowCreate] = useState(false);
  const users = useQuery({
    queryKey: ["users", search],
    queryFn: () =>
      api<{ users: PublicUser[]; nextCursor: string | null }>(`/api/v1/users?query=${encodeURIComponent(search)}`),
  });

  return (
    <main className="landing">
      <nav className="landing-nav">
        <Brand />
        <div className="landing-nav-links">
          <span className="nav-note">好きの輪郭を、ていねいに。</span>
          <Link to="/about-analyzer">
            分析器の現在地 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">CHARACTER PREFERENCE LAB</p>
          <h1>
            「好き」を集めて、
            <br />
            <em>まだ知らない一人</em>に出会う。
          </h1>
          <p className="hero-description">
            キャラクターのどんな表情、葛藤、関係性に惹かれるのか。根拠と確かさを分けて分析し、あなただけの新しいキャラクターへつなげます。
          </p>
          <div className="hero-metrics">
            <span>
              <strong>根拠つき</strong>
              <small>原文から追跡</small>
            </span>
            <span>
              <strong>育つ分析</strong>
              <small>入力と評価で更新</small>
            </span>
            <span>
              <strong>非公開</strong>
              <small>内容は本人だけ</small>
            </span>
          </div>
        </div>

        <div className="user-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">SELECT USER</p>
              <h2>ユーザーを選ぶ</h2>
            </div>
            <button type="button" className="button button-secondary" onClick={() => setShowCreate(true)}>
              ＋ 新規作成
            </button>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ユーザー名を検索" />
          </label>
          <div className="user-list">
            {users.isPending && <Spinner />}
            {users.isError && <Notice tone="danger">ユーザー一覧を読み込めませんでした。</Notice>}
            {users.data?.users.length === 0 && <p className="muted centered">該当するユーザーはいません。</p>}
            {users.data?.users.map((user) => (
              <button type="button" className="user-row" key={user.id} onClick={() => setSelectedUser(user)}>
                <span className="avatar">{Array.from(user.username)[0]?.toUpperCase()}</span>
                <span>
                  <strong>{user.username}</strong>
                  <small>{user.id.slice(0, 8)}</small>
                </span>
                <span className="row-arrow">→</span>
              </button>
            ))}
          </div>
          <p className="privacy-note">
            公開されるのはユーザー名だけです。分析内容や生成履歴はアクセスキーで保護されます。
          </p>
        </div>
      </section>
      <section className="process-strip" aria-label="使い方">
        <span>
          <b>01</b>
          <strong>キャラを登録</strong>
          <small>概要と、任意で好きな理由</small>
        </span>
        <i>→</i>
        <span>
          <b>02</b>
          <strong>傾向を分析</strong>
          <small>頻出と明示嗜好を分けて表示</small>
        </span>
        <i>→</i>
        <span>
          <b>03</b>
          <strong>新しい一人を生成</strong>
          <small>評価から分析がさらに育つ</small>
        </span>
      </section>

      {selectedUser && <LoginModal user={selectedUser} onClose={() => setSelectedUser(undefined)} onLogin={onLogin} />}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onActivated={() => queryClient.invalidateQueries({ queryKey: ["users"] })}
        />
      )}
    </main>
  );
}

function LoginModal({
  user,
  onClose,
  onLogin,
}: {
  user: PublicUser;
  onClose(): void;
  onLogin(user: SessionUser): void;
}) {
  const [accessKey, setAccessKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await api<{ user: SessionUser; csrfToken: string }>("/api/v1/sessions", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, accessKey, turnstileToken }),
      });
      setCsrfToken(response.csrfToken);
      onLogin(response.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ログインできませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`${user.username} としてログイン`} onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <p className="muted">ユーザー作成時に発行されたUUIDアクセスキーを入力してください。</p>
        <label>
          <span>アクセスキー</span>
          <input
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="current-password"
            required
          />
        </label>
        <Turnstile onToken={setTurnstileToken} />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="button button-primary button-large" disabled={submitting}>
          {submitting ? "確認中…" : "ラボに入る"}
        </button>
      </form>
    </Modal>
  );
}

function CreateUserModal({ onClose, onActivated }: { onClose(): void; onActivated(): void }) {
  const [username, setUsername] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [created, setCreated] = useState<{ user: PublicUser; accessKey: string; expiresAt: string }>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const requestKey = useRef(idempotencyKey());

  async function create(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await api<{ user: PublicUser; accessKey: string; expiresAt: string }>("/api/v1/users", {
        method: "POST",
        idempotencyKey: requestKey.current,
        body: JSON.stringify({ username, turnstileToken, idempotencyKey: requestKey.current }),
      });
      setCreated(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "作成できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  async function activate() {
    if (!created) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api(`/api/v1/users/${created.user.id}/activate`, {
        method: "POST",
        body: JSON.stringify({ accessKey: created.accessKey }),
      });
      onActivated();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "有効化できませんでした");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadKey() {
    if (!created) return;
    const blob = new Blob(
      [
        `キャラ嗜好ラボ アクセスキー\n\nユーザー名: ${created.user.username}\nユーザーID: ${created.user.id}\nアクセスキー: ${created.accessKey}\n\nこのキーは再発行・復旧できません。安全な場所に保管してください。\n`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `character-taste-key-${created.user.username}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (created) {
    return (
      <Modal title="アクセスキーを保存" onClose={onClose}>
        <div className="stack-form">
          <Notice tone="warning">
            <strong>この画面を閉じると、キーは二度と表示できません。</strong>
            <br />
            紛失した場合、アカウントは復旧できません。
          </Notice>
          <div className="credential-box">
            <small>UUID ACCESS KEY</small>
            <code>{created.accessKey}</code>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(created.accessKey);
                setCopied(true);
              }}
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            <button type="button" className="button button-secondary" onClick={downloadKey}>
              テキストで保存
            </button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>アクセスキーを安全な場所に保存しました</span>
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <button
            type="button"
            className="button button-primary button-large"
            disabled={!acknowledged || submitting}
            onClick={activate}
          >
            {submitting ? "有効化中…" : "保存を確認してユーザーを作成"}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="新しいユーザーを作成" onClose={onClose}>
      <form className="stack-form" onSubmit={create}>
        <label>
          <span>ユーザー名</span>
          <input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              requestKey.current = idempotencyKey();
            }}
            maxLength={32}
            required
            placeholder="表示する名前"
          />
          <small>公開一覧に表示され、重複はできません。</small>
        </label>
        <Turnstile onToken={setTurnstileToken} />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="button button-primary button-large" disabled={submitting}>
          {submitting ? "作成中…" : "アクセスキーを発行"}
        </button>
      </form>
    </Modal>
  );
}
