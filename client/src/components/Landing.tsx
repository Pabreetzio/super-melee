import { useState, useEffect, useRef } from 'react';
import { client } from '../net/client';

interface Props {
  initialName: string;
  onNameSet: (name: string) => void;
}

export default function Landing({ initialName, onNameSet }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) {
      setError('A commander needs a name. Even a bad one.');
      return;
    }
    client.send({ type: 'set_name', name: trimmed });
    onNameSet(trimmed);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') submit();
  }

  return (
    <div className="screen">
      <div className="panel col" style={{ width: 380, gap: 20 }}>
        <h1 style={{ textAlign: 'center', color: 'var(--accent)', fontSize: 20 }}>
          ★ Super Melee ★
        </h1>

        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
          Welcome, Commander. Identify yourself before proceeding to the engagement roster.
        </p>

        <div className="col" style={{ gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            COMMANDER NAME
          </label>
          <input
            ref={inputRef}
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            onKeyDown={onKey}
            maxLength={30}
            placeholder="e.g. Captain Benson"
            style={{ width: '100%' }}
          />
          {error && <span className="error-msg">{error}</span>}
        </div>

        <button className="success" onClick={submit}>
          Enter the Melee
        </button>

        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
          Star Control 2 fan project — non-commercial
        </p>
      </div>
    </div>
  );
}
