/**
 * LTTV is built as four apps from one code base. Each opens only its own part:
 *   lttv        — Live TV and Sports (the main app; it shares your provider with the others)
 *   movies      — Movies & Shows
 *   leaguepass  — LTTV League Pass (NBA)
 *   blitz       — LTTV Blitz (NFL)
 * The Fire TV app passes ?app=… ; the computer version is always "lttv".
 */
export type AppMode = 'lttv' | 'movies' | 'leaguepass' | 'blitz';

export const APP_MODE: AppMode = (() => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('app') : null;
  return q === 'movies' || q === 'leaguepass' || q === 'blitz' ? q : 'lttv';
})();

/** The file each app updates itself from (in the GitHub release). */
export const APK_NAME: Record<AppMode, string> = {
  lttv: 'lttv.apk',
  movies: 'lttv-movies.apk',
  leaguepass: 'lttv-leaguepass.apk',
  blitz: 'lttv-blitz.apk',
};

export const APP_TITLE: Record<AppMode, string> = {
  lttv: 'LTTV',
  movies: 'Movies & Shows',
  leaguepass: 'League Pass',
  blitz: 'Blitz',
};

export const isPassApp = APP_MODE === 'leaguepass' || APP_MODE === 'blitz';
