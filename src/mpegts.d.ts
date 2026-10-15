// Minimal types for the parts of mpegts.js LTTV uses (vendored source, see vendor/VERSIONS.md).
declare module 'mpegts.js' {
  export interface MpegtsPlayer {
    attachMediaElement(el: HTMLMediaElement): void;
    detachMediaElement(): void;
    load(): void;
    unload(): void;
    play(): Promise<void> | void;
    pause(): void;
    destroy(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }
  const mpegts: {
    isSupported(): boolean;
    getFeatureList(): { mseLivePlayback: boolean; mseLiveH265Playback?: boolean };
    createPlayer(media: { type: string; isLive?: boolean; url: string }, config?: Record<string, unknown>): MpegtsPlayer;
    Events: { ERROR: string; MEDIA_INFO: string; [k: string]: string };
    ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string; OTHER_ERROR: string };
    ErrorDetails: Record<string, string>;
    LoggingControl: { enableAll: boolean; enableDebug: boolean; enableVerbose: boolean; enableInfo: boolean; enableWarn: boolean; enableError: boolean };
  };
  export default mpegts;
}
