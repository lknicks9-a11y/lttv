// League Pass / Blitz: the secret settings code (Down, Down, Up, Up, Left).
import { useEffect, useState } from 'preact/hooks';

const D = 'ArrowDown';
const U = 'ArrowUp';
const SECRET = [D, D, U, U, 'ArrowLeft'];

/** Opens the secret settings when the code is pressed. */
export function useSecretSettings(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let recent: { key: string; at: number }[] = [];
    const on = (e: KeyboardEvent) => {
      const now = Date.now();
      if (recent.length && now - recent[recent.length - 1].at > 2500) recent = [];
      recent = [...recent, { key: e.key, at: now }].slice(-SECRET.length);
      if (recent.length === SECRET.length && SECRET.every((k, i) => recent[i].key === k)) {
        recent = [];
        setOpen(true);
      }
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);
  return [open, setOpen];
}

