import { useEffect, useRef, useState } from 'react';
import { api, type SessionInfo, type TelegramUser } from '../api';

interface Props {
  onTelegram: (user: TelegramUser) => Promise<void>;
  onKey: (key: string) => Promise<void>;
}

declare global {
  interface Window {
    onSlipboxTelegramAuth?: (user: TelegramUser) => void;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Telegram's Login Widget: a script that renders the official button in an iframe. */
function TelegramButton({ bot, onAuth }: { bot: string; onAuth: (user: TelegramUser) => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const handler = useRef(onAuth);
  handler.current = onAuth;

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    window.onSlipboxTelegramAuth = (user) => handler.current(user);
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.dataset.telegramLogin = bot;
    script.dataset.size = 'large';
    script.dataset.radius = '7';
    script.dataset.userpic = 'false';
    script.dataset.onauth = 'onSlipboxTelegramAuth(user)';
    el.appendChild(script);
    return () => {
      el.innerHTML = '';
      delete window.onSlipboxTelegramAuth;
    };
  }, [bot]);

  return <div className="telegram-slot" ref={slot} />;
}

export function SignInScreen({ onTelegram, onKey }: Props) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');

  useEffect(() => {
    api.session().then(setInfo, (e) => setError(message(e)));
  }, []);

  const telegram = async (user: TelegramUser) => {
    setBusy(true);
    setError(null);
    try {
      await onTelegram(user);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onKey(key.trim());
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  const useTelegram = info?.method === 'telegram';

  return (
    <div className="boot unlock-stage">
      <div className="card unlock">
        <header className="card-head">
          <h1 className="card-title">Sign in to Slipbox</h1>
        </header>
        <div className="card-body">
          {!info && !error && <p className="muted">Checking how to sign in…</p>}

          {useTelegram && (
            <>
              <p className="muted">Only Telegram accounts on this Slipbox's allowed list can open it. You'll stay signed in for 30 days.</p>
              {info.telegramBot ? (
                busy ? <p className="muted">Signing in…</p> : <TelegramButton bot={info.telegramBot} onAuth={telegram} />
              ) : (
                <p className="form-error">The server couldn't look up its Telegram bot. Check the bot token in the server's settings.</p>
              )}
            </>
          )}

          {info && !useTelegram && (
            <form onSubmit={submitKey} className="unlock-form">
              <p className="muted">Enter one of your API keys to open it on this device. You'll stay signed in for 30 days.</p>
              <label className="field">
                <span className="field-label">API key</span>
                <input className="input" type="password" autoComplete="current-password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary block" disabled={busy || !key.trim()}>
                {busy ? 'Unlocking…' : 'Unlock'}
              </button>
            </form>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
