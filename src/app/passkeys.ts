// Up, Up, Left, Right opens League Pass; Up ×5, Down ×2, Right opens Blitz. On Fire TV they're their own apps
// now, so LTTV starts that app (LTTV itself no longer carries League Pass or Blitz).
import { getState, setState, toast } from './state';
import { isNative, native } from './platform';

const U = 'ArrowUp';
const SEQS: ['nba' | 'nfl', string[]][] = [['nba', [U, U, 'ArrowLeft', 'ArrowRight']], ['nfl', [U, U, U, U, U, 'ArrowDown', 'ArrowDown', 'ArrowRight']]];
let recent: { key: string; at: number }[] = [];

export function openPassApp(league: 'nba' | 'nfl') {
  if (isNative && native?.openApp) {
    const which = league === 'nba' ? 'leaguepass' : 'blitz';
    if (!native.openApp(which)) toast(`Get ${league === 'nba' ? 'League Pass' : 'Blitz'} from LTTV Home → Store.`, 'info', 6000);
    return;
  }
  // On the computer they still open inside LTTV.
  void import('../ui/LeaguePass').then((m) => m.openPass(league));
}

export function watchPassKeys(): () => void {
  const on = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const now = Date.now();
    if (recent.length && now - recent[recent.length - 1].at > 2500) recent = [];
    recent = [...recent, { key: e.key, at: now }].slice(-8);
    const hit = SEQS.find(([, seq]) => recent.length >= seq.length && seq.every((k, i) => recent[recent.length - seq.length + i].key === k));
    if (hit) {
      recent = [];
      if (getState().leaguePass) return;
      openPassApp(hit[0]);
    }
  };
  window.addEventListener('keydown', on, true);
  return () => window.removeEventListener('keydown', on, true);
}

