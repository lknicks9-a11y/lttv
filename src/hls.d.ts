// Minimal typings for the parts of hls.js LTTV uses (the vendored source is bundled by esbuild).
declare module 'hls.js' {
  interface HlsErrorData {
    type: string;
    details: string;
    fatal: boolean;
    response?: { code?: number; text?: string };
  }
  interface LevelLoadedData {
    details: { live: boolean };
  }
  export default class Hls {
    constructor(config?: Record<string, unknown>);
    static isSupported(): boolean;
    static readonly Events: { ERROR: 'hlsError'; MANIFEST_PARSED: 'hlsManifestParsed'; LEVEL_LOADED: 'hlsLevelLoaded' };
    static readonly ErrorTypes: { NETWORK_ERROR: 'networkError'; MEDIA_ERROR: 'mediaError'; OTHER_ERROR: 'otherError' };
    on(event: 'hlsError', cb: (e: string, data: HlsErrorData) => void): void;
    on(event: 'hlsLevelLoaded', cb: (e: string, data: LevelLoadedData) => void): void;
    on(event: string, cb: (e: string, data: never) => void): void;
    loadSource(url: string): void;
    attachMedia(el: HTMLMediaElement): void;
    recoverMediaError(): void;
    startLoad(): void;
    destroy(): void;
    /** Position near the live edge hls.js would play at (null before a live playlist loads). */
    readonly liveSyncPosition: number | null;
    readonly targetLatency: number | null;
    readonly config: { backBufferLength: number } & Record<string, unknown>;
  }
}
