/**
 * The one-JSON-line-per-event log transport.
 *
 * Nest's `Logger` is deliberately *not* this: it renders a human-readable, coloured line with
 * a timestamp and a context prefix, which a collector has to regex apart before it can index
 * anything. Events that exist to be queried later — "which request failed", "how many rows did
 * retention delete last night" — are written here instead, as a single self-describing JSON
 * object per line, so `docker logs | jq` and a log aggregator both read them the same way.
 *
 * Nest's `Logger` keeps everything else: startup notices, warnings and errors are read by a
 * human tailing the container, and dressing those up as JSON would only make them harder to
 * scan.
 */

/** Writes a single, already-serialised line to the log sink. */
export type LogWriter = (line: string) => void;

/**
 * The production sink: stdout, unbuffered per line.
 *
 * Container runtimes collect stdout — there is no log file to rotate, no path to configure,
 * and nothing to mount. See docs/development.md.
 */
export const stdoutWriter: LogWriter = (line) => {
  process.stdout.write(`${line}\n`);
};
