"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { configure, fragment, Session, audit } = require("./mapping.js");
const small = configure({ K: 8, aBase: "0", bBase: "0" });

test("K=8 concrete A and B source, byte, and shared audit examples", () => {
  const examples = [
    { t: 0, A: ["0.0", "32.0", "64.0", "96.0"], B: ["0.0", "0.32", "0.64", "0.96"], indices: [0, 32, 64, 96] },
    { t: 1, A: ["0.1", "32.1", "64.1", "96.1"], B: ["1.0", "1.32", "1.64", "1.96"], indices: [132, 164, 196, 228] },
    { t: 8, A: ["1.0", "33.0", "65.0", "97.0"], B: ["0.1", "0.33", "0.65", "0.97"], indices: [1, 33, 65, 97] },
    { t: 255, A: ["31.7", "63.7", "95.7", "127.7"], B: ["7.31", "7.63", "7.95", "7.127"], indices: [955, 987, 1019, 1051] }
  ];
  for (const example of examples) for (const op of ["A", "B"]) {
    const values = Array.from({ length: 4 }, (_, i) => fragment(small, op, example.t, i, 0));
    assert.deepEqual(values.map((v) => v.coord), example[op]);
    assert.deepEqual(values.map((v) => v.arrayIndex), example.indices);
  }
  const t0 = Array.from({ length: 4 }, (_, i) => fragment(small, "A", 0, i, 0));
  assert.deepEqual(t0.map((v) => v.offset), [0n, 256n, 512n, 768n]);
  assert.deepEqual(t0.map((v) => v.effective), [0n, 1024n, 2048n, 3072n]);
});

test("independent exhaustive formula: shifted origins, both layouts, all lanes, stages and tiles", () => {
  const c = configure({ M: 1024, N: 2048, K: 24, blockRow: 129, blockColumn: 987, aBase: "0xFEDCBA0000000000", bBase: "9007199254740993" });
  for (const op of ["A", "B"]) for (let q = 0; q < 3; q++) for (let stage = 0; stage < 2; stage++) {
    const owners = new Set();
    for (let t = 0; t < 256; t++) for (let i = 0; i < 4; i++) {
      const v = fragment(c, op, t, i, q, stage);
      const first = Math.floor(t / 8);
      const k = q * 8 + t % 8;
      const outer = (op === "A" ? 129 : 987) + first + i * 32;
      const offset = BigInt(outer) * 24n + BigInt(k);
      assert.equal(v.row, op === "A" ? outer : k);
      assert.equal(v.col, op === "A" ? k : outer);
      assert.equal(v.offset, offset);
      assert.equal(v.effective, (op === "A" ? c.aBase : c.bBase) + offset * 4n);
      assert.equal(v.effective, v.incoming + BigInt(i) * 32n * 24n * 4n);
      assert.equal(v.arrayIndex, (stage * 8 + t % 8) * 132 + first + i * 32);
      assert.equal(v.byteOffset, v.arrayIndex * 4);
      assert.equal(v.bank, v.arrayIndex % 32);
      assert.equal(v.unionByteOffset, v.byteOffset + (op === "B" ? 8448 : 0));
      assert.equal(v.warp, Math.floor(t / 32));
      assert.equal(v.lane, t % 32);
      assert.equal(v.subgroup, Math.floor((t % 32) / 8));
      assert.equal(v.subgroupLane, t % 8);
      assert.ok(v.offset >= 0n && v.offset < BigInt(op === "A" ? c.M : c.N) * 24n);
      assert.equal(v.nextIncoming, q < 2 ? v.incoming + 32n : null);
      assert.ok(!owners.has(v.arrayIndex));
      owners.add(v.arrayIndex);
    }
    assert.equal(owners.size, 1024);
    assert.equal(owners.size * 4, 4096);
    for (let row = stage * 8; row < stage * 8 + 8; row++) for (let col = 0; col < 132; col++) {
      assert.equal(owners.has(row * 132 + col), col < 128);
    }
  }
});

test("q1 advances every effective and incoming address by 32 bytes, not shared destinations", () => {
  const c = configure({ K: 16 });
  for (const op of ["A", "B"]) for (let t = 0; t < 256; t++) for (let i = 0; i < 4; i++) {
    const before = fragment(c, op, t, i, 0);
    const after = fragment(c, op, t, i, 1);
    assert.equal(after.incoming - before.incoming, 32n);
    assert.equal(after.effective - before.effective, 32n);
    assert.equal(after.arrayIndex, before.arrayIndex);
  }
  assert.throws(() => fragment(small, "A", 0, 0, 1));
  assert.equal(fragment(small, "B", 255, 3, 0).nextIncoming, null);
});

test("64-bit bases and large element offsets never pass through floating-point address arithmetic", () => {
  const c = configure({ K: 8, aBase: "0xFFFFFFFFFFFE0000", bBase: "9007199254740993" });
  assert.equal(fragment(c, "B", 1, 0, 0).effective, 9007199254740997n);
  assert.equal(fragment(c, "A", 255, 3, 0).effective, c.aBase + 4092n);
  const huge = configure({ M: 1000000000, K: 1000000000, blockRow: 999999872, aBase: "0" });
  assert.equal(fragment(huge, "A", 255, 3, 124999999).offset, 999999999999999999n);
});

test("validation rejects unsafe dimensions, partial tiles, invalid origins, malformed or overflowing addresses", () => {
  for (const bad of [
    { K: 0 }, { K: 7 }, { K: -8 }, { K: 8.5 }, { K: "" }, { K: Infinity }, { K: Number.MAX_SAFE_INTEGER + 1 },
    { M: 127 }, { N: 0 }, { M: 128, blockRow: 1 }, { N: 128, blockColumn: 1 },
    { blockRow: -1 }, { blockColumn: 1.2 }, { blockRow: "" },
    { aBase: "-1" }, { bBase: "1.5" }, { aBase: "0x" }, { aBase: "1e10" },
    { aBase: "18446744073709551616" }, { aBase: "18446744073709551615" }
  ]) assert.throws(() => configure(bad), JSON.stringify(bad));
  assert.equal(configure({ M: 128, N: 128, K: 8, aBase: "0", bBase: "0" }).K, 8);
  for (const args of [["C", 0, 0, 0], ["A", 256, 0, 0], ["A", 0, 4, 0], ["B", 0, 0, -1], ["A", 0, 0, 0, 2]]) {
    assert.throws(() => fragment(small, ...args));
  }
});

test("serial UI action guards: Load → Loaded → Store → Ready, locks and exhaustion", () => {
  const s = new Session({ K: 8 });
  assert.equal(s.canLoad, true);
  assert.equal(s.canStore, false);
  assert.equal(s.beginStore(), false);
  assert.equal(s.finishStore(), false);
  assert.equal(s.finishLoad(), false);
  assert.equal(s.beginLoad(), true);
  assert.equal(s.busy, true);
  assert.equal(s.pending, 0);
  assert.equal(s.beginLoad(), false);
  assert.equal(s.canStore, false);
  assert.equal(s.beginStore(), false);
  assert.equal(s.finishLoad(), true);
  assert.equal(s.phase, "loaded");
  assert.deepEqual(s.loadedSlots, { A: 4, B: 4 });
  assert.equal(s.beginLoad(), false);
  assert.equal(s.beginStore(), true);
  assert.equal(s.busy, true);
  assert.equal(s.canLoad, false);
  assert.equal(s.canStore, false);
  assert.equal(s.beginStore(), false);
  assert.equal(s.finishStore(), true);
  assert.equal(s.phase, "ready");
  assert.equal(s.stored, 0);
  assert.equal(s.pending, null);
  assert.equal(s.nextTile, 1);
  assert.equal(s.canLoad, false);
  assert.equal(s.beginLoad(), false);
  assert.equal(s.displayTile, 0);
});

test("pending and stored tile remain distinct; view/operand toggles preserve progression and pin ownership", () => {
  const s = new Session({ K: 16 });
  s.setPin(255, 3);
  s.beginLoad();
  s.setOperand("B");
  s.setView("shared");
  assert.equal(s.phase, "loading");
  assert.equal(s.pending, 0);
  assert.deepEqual(s.pin, { t: 255, i: 3, source: "trace" });
  s.finishLoad();
  s.beginStore();
  s.finishStore();
  s.setPin(1, null, "shared");
  s.beginLoad();
  assert.equal(s.stored, 0);
  assert.equal(s.pending, 1);
  assert.equal(s.displayTile, 1);
  s.finishLoad();
  s.setOperand("A");
  s.setView("global");
  assert.equal(s.stored, 0);
  assert.equal(s.pending, 1);
  assert.deepEqual(s.pin, { t: 1, i: null, source: "shared" });
  s.beginStore();
  assert.equal(s.stored, 0);
  s.finishStore();
  assert.equal(s.stored, 1);
  assert.equal(s.canLoad, false);
  assert.throws(() => s.setOperand("C"));
  assert.throws(() => s.setView("other"));
  assert.throws(() => s.setPin(256));
});

test("in-page audit passes for default, minimum, and shifted configurations", () => {
  for (const c of [configure(), small, configure({ M: 1024, N: 1024, K: 16, blockRow: 73, blockColumn: 85 })]) {
    const result = audit(c);
    assert.match(result.message, /^PASS/);
    assert.ok(result.checks > 14000);
  }
});
