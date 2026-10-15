// mpegts.js can run its demuxer in a Web Worker via a webpack-only helper. LTTV runs
// it on the main thread (enableWorker: false), so this is never called.
export default function work() {
  throw new Error('mpegts.js worker mode is not available in this build');
}
