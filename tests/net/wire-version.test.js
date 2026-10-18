import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_VERSION } from '../../src/config.js';
import { PROTOCOL_VERSION, wireFingerprint } from '../../src/net/wire-version.js';
import { EVENT_SHAPES } from '../../src/net/delta.js';
import { COMMAND_SPECS } from '../../src/net/sanitize.js';
import { MSG } from '../../src/net/protocol.js';
import { UNITS } from '../../src/data/index.js';

test('the protocol version is the game version plus a fingerprint of the wire tables', () => {
  assert.match(PROTOCOL_VERSION, /^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
  assert.ok(PROTOCOL_VERSION.startsWith(`${GAME_VERSION}+`));
  assert.equal(PROTOCOL_VERSION, `${GAME_VERSION}+${wireFingerprint()}`);
  assert.ok(PROTOCOL_VERSION.length <= 32, 'receivers keep 32 characters of a version');
  assert.equal(wireFingerprint(), wireFingerprint(), 'deterministic');
});

test('the fingerprint changes when a wire table changes (stale builds are refused at join)', () => {
  const base = wireFingerprint();
  const tweak = (change, undo) => {
    change();
    const changed = wireFingerprint();
    undo();
    assert.notEqual(changed, base);
    assert.equal(wireFingerprint(), base);
  };
  tweak(() => EVENT_SHAPES.push({ type: 'x', keys: ['y'] }), () => EVENT_SHAPES.pop());
  tweak(() => { MSG.EXTRA = 'extra'; }, () => { delete MSG.EXTRA; });
  tweak(() => { COMMAND_SPECS.extra = {}; }, () => { delete COMMAND_SPECS.extra; });
  tweak(() => { UNITS.extra_unit = {}; }, () => { delete UNITS.extra_unit; });
});
