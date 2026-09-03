import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { api, idempotencyKey, setCsrfToken } from "../api";
import { Turnstile } from "../components/Turnstile";
import { Brand, Modal, Notice } from "../components/Ui";

type PublicUser = { id: string; username: string };
type SessionUser = { id: string; username: string };

export function Landing({
  domain,
  user,
  onLogin,
}: {
  domain: AnalysisDomain;
  user?: SessionUser;
  onLogin(user: SessionUser): void;
}) {
  const dark = domain === "dark";
  const [showCreate, setShowCreate] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  return (
    <main className={`landing ${dark ? "dark-lab-theme dark-landing" : ""}`}>
      <nav className="landing-nav">
        <Brand />
        <div className="landing-nav-links">
          <span className="nav-note">{dark ? "闇に惹かれる理由を、解像する。" : "好きの輪郭を、ていねいに。"}</span>
          {dark && <Link to="/">通常のキャラ嗜好ラボへ</Link>}
          <Link to={dark ? "/dark-lab/about-analyzer" : "/about-analyzer"}>
            分析器の現在地 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{dark ? "DARK CHARACTER PREFERENCE LAB" : "CHARACTER PREFERENCE LAB"}</p>
          <h1>
            {dark ? "悪、堕落、支配の" : "「好き」を集めて、"}
            <br />
            <em>{dark ? "どこに惹かれるのか。" : "まだ知らない一人"}</em>
            {dark ? "" : "に出会う。"}
          </h1>
          <p className="hero-description">
            {dark
              ? "悪役、洗脳された勇者、堕落した英雄、裏切者、ヴィラン主人公、アンチヒーロー。主体性・支配・自我・道徳・変化差分を専用Ontologyで深く分析します。"
              : "キャラクターのどんな表情、葛藤、関係性に惹かれるのか。根拠と確かさを分けて分析し、あなただけの新しいキャラクターへつなげます。"}
          </p>
          <div className="hero-metrics">
            <span>
              <strong>{dark ? "専用解析" : "根拠つき"}</strong>
              <small>{dark ? "通常属性へ変換しない" : "原文から追跡"}</small>
            </span>
            <span>
              <strong>{dark ? "状態と差分" : "育つ分析"}</strong>
              <small>{dark ? "主体性と変化を分離" : "入力と評価で更新"}</small>
            </span>
            <span>
              <strong>{dark ? "domain分離" : "非公開"}</strong>
              <small>{dark ? "通常版へ混入しない" : "内容は本人だけ"}</small>
            </span>
          </div>
        </div>

        {user ? (
          <div className="user-panel signed-in-panel">
            <p className="eyebrow">SIGNED IN</p>
            <h2>
              {user.username} の{dark ? "ダーク" : "キャラ"}ラボ
            </h2>
            <p className="muted">アカウントは両ラボで共有され、分析結果と生成履歴は分離されます。</p>
            <Link className="button button-primary button-large" to={dark ? "/dark-lab/app/profile" : "/app/profile"}>
              {dark ? "ダークラボに入る" : "ラボに入る"}
            </Link>
          </div>
        ) : (
          <div className="user-panel landing-access-panel">
            <div>
              <p className="eyebrow">WELCOME</p>
              <h2>ラボをはじめる</h2>
            </div>
            <div className="landing-actions">
              <button type="button" className="button button-primary button-large" onClick={() => setShowCreate(true)}>
                新規ユーザ作成
              </button>
              <button type="button" className="button button-secondary button-large" onClick={() => setShowLogin(true)}>
                ログイン
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="process-strip" aria-label="使い方">
        <span>
          <b>01</b>
          <strong>{dark ? "ダーク状態を登録" : "キャラを登録"}</strong>
          <small>{dark ? "注目状態は必須" : "概要と、任意で好きな理由"}</small>
        </span>
        <i>→</i>
        <span>
          <b>02</b>
          <strong>{dark ? "多段解析と監査" : "傾向を分析"}</strong>
          <small>{dark ? "主体性・差分・根拠を確認" : "頻出と明示嗜好を分けて表示"}</small>
        </span>
        <i>→</i>
        <span>
          <b>03</b>
          <strong>{dark ? "ダークキャラを生成" : "新しい一人を生成"}</strong>
          <small>{dark ? "専用Schemaで設計" : "評価から分析がさらに育つ"}</small>
        </span>
      </section>
      <footer className="landing-footer">
        <a href="/third-party-licenses.html">サードパーティライセンス</a>
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onLogin={onLogin} />}
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </main>
  );
}

function LoginModal({ onClose, onLogin }: { onClose(): void; onLogin(user: SessionUser): void }) {
  const [username, setUsername] = useState("");
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
        body: JSON.stringify({ username, accessKey, turnstileToken }),
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
    <Modal title="ログイン" onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <p className="muted">ユーザー作成時のユーザー名とログインキーを入力してください。</p>
        <label>
          <span>ユーザー名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={32}
            autoComplete="username"
            required
          />
        </label>
        <label>
          <span>ログインキー</span>
          <input
            type="password"
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
          {submitting ? "確認中…" : "ログイン"}
        </button>
      </form>
    </Modal>
  );
}

function CreateUserModal({ onClose }: { onClose(): void }) {
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
          <small>ログイン時に使います。同じユーザー名は登録できません。</small>
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
