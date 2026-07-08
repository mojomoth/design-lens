/**
 * Unit tests for `serve`'s pure `--port` grammar.
 *
 * WHY these exist: unit tests may not bind ports (spec 08), so everything `serve` can be proved about
 * without a socket is proved here — and the port parser is the one place a bad value causes a SILENT
 * wrong behaviour rather than an error. `server.listen(NaN)` does not throw; it binds an ephemeral
 * port. So `serve --port 80abc` would happily serve on a random port the user never asked for, print
 * it, and look like it worked. These cases pin the rejection.
 *
 * The listening half of `serve` is covered by `test/e2e/serve.test.ts` against the built bundle.
 */

import { describe, expect, it } from 'vitest';

import { parsePort } from '../../src/commands/serve.js';

describe('parsePort', () => {
  // why: the spec fixes the default at 0 = "let the OS pick". If an absent flag ever resolved to a
  // fixed port, two concurrent `serve` runs (or a test suite) would collide on it.
  it('defaults to 0 (ephemeral) when --port is absent', () => {
    expect(parsePort(undefined)).toBe(0);
  });

  // why: the ordinary path — an explicit port must reach `listen()` as a number, not a string.
  it('parses an explicit port', () => {
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort('0')).toBe(0);
    expect(parsePort('65535')).toBe(65535);
  });

  // why: commander hands us raw argv; a trailing newline or space from a shell substitution must not
  // turn a valid port into a NaN that silently binds elsewhere.
  it('tolerates surrounding whitespace', () => {
    expect(parsePort(' 4321 ')).toBe(4321);
  });

  // why: THE reason this function exists. `Number('80abc')` is NaN and `listen(NaN)` binds a random
  // port instead of failing, so a typo would be indistinguishable from success. Same for a float,
  // which `listen()` truncates.
  it.each(['80abc', 'abc', '', '  ', '80.5', '-1', '+80', '0x50', '1e3'])(
    'rejects the non-integer port %o',
    (raw) => {
      expect(() => parsePort(raw)).toThrow(/invalid --port/);
    },
  );

  // why: a port above the 16-bit range cannot be bound; `listen(65536)` throws deep inside node with
  // an opaque ERR_SOCKET_BAD_PORT. Rejecting it here produces the actionable one-line error the CLI
  // contract promises (exit 1, cause + hint).
  it('rejects a port above 65535', () => {
    expect(() => parsePort('65536')).toThrow(/expected an integer between 0 and 65535/);
    expect(() => parsePort('99999')).toThrow(/invalid --port/);
  });

  // why: the error message must quote the offending value — an agent reading stderr needs to know
  // WHICH flag value it fumbled, not merely that some port was bad.
  it('names the offending value in the error', () => {
    expect(() => parsePort('80abc')).toThrow('invalid --port "80abc"');
  });
});
