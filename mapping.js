(function (root) {
  "use strict";
  const C = Object.freeze({ BLOCK_M: 128, BLOCK_N: 128, BLOCK_K: 8, THREADS: 256, STRIDE: 132, STAGES: 2 });
  const DEFAULTS = Object.freeze({ M: 4096, N: 4096, K: 4096, blockRow: 0, blockColumn: 0, aBase: "0x100000000", bBase: "0x200000000" });
  const U64 = (1n << 64n) - 1n;

  function address(value) {
    const text = String(value).trim();
    if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(text)) throw new Error("Bases must be unsigned decimal or hexadecimal integers.");
    const result = BigInt(text);
    if (result > U64) throw new Error("Bases must fit in an unsigned 64-bit address.");
    return result;
  }

  function configure(input = {}) {
    const c = { ...DEFAULTS, ...input };
    for (const key of ["M", "N", "K", "blockRow", "blockColumn"]) {
      if (String(c[key]).trim() === "") throw new Error(`${key} is required.`);
      c[key] = Number(c[key]);
      if (!Number.isSafeInteger(c[key]) || c[key] < (key.startsWith("block") ? 0 : 1)) {
        throw new Error(`${key} must be a ${key.startsWith("block") ? "nonnegative" : "positive"} safe integer.`);
      }
    }
    if (c.K % 8) throw new Error("MATRIX_K must be a positive multiple of 8.");
    if (c.M < 128 || c.N < 128 || c.blockRow > c.M - 128 || c.blockColumn > c.N - 128) {
      throw new Error("The full 128 × 128 block must fit inside M × N.");
    }
    c.aBase = address(c.aBase);
    c.bBase = address(c.bBase);
    for (const [base, rows] of [[c.aBase, c.M], [c.bBase, c.N]]) {
      if (base + BigInt(rows) * BigInt(c.K) * 4n - 1n > U64) throw new Error("The simulated matrix extends beyond the 64-bit address range.");
    }
    return Object.freeze(c);
  }

  function fragment(c, operand, t, i, q, stage = 0) {
    if (!["A", "B"].includes(operand) || !Number.isInteger(t) || t < 0 || t >= 256 ||
        !Number.isInteger(i) || i < 0 || i > 3 || !Number.isInteger(q) || q < 0 || q >= c.K / 8 ||
        !Number.isInteger(stage) || stage < 0 || stage > 1) throw new Error("Invalid fragment coordinates.");
    const first = Math.floor(t / 8);
    const localK = t % 8;
    const k = q * 8 + localK;
    const origin = operand === "A" ? c.blockRow : c.blockColumn;
    const outer = origin + first + 32 * i;
    const base = operand === "A" ? c.aBase : c.bBase;
    const offset = BigInt(outer) * BigInt(c.K) + BigInt(k);
    const incoming = base + (BigInt(origin + first) * BigInt(c.K) + BigInt(k)) * 4n;
    const sharedRow = stage * 8 + localK;
    const sharedCol = first + 32 * i;
    const arrayIndex = sharedRow * 132 + sharedCol;
    return {
      operand, t, i, q, stage, first, localK, k, outer,
      warp: Math.floor(t / 32), lane: t % 32, subgroup: Math.floor((t % 32) / 8), subgroupLane: t % 8,
      row: operand === "A" ? outer : k, col: operand === "A" ? k : outer,
      coord: operand === "A" ? `${outer}.${k}` : `${k}.${outer}`,
      offset, incoming, effective: base + offset * 4n,
      fragmentStep: 32n * BigInt(c.K) * 4n,
      nextIncoming: q + 1 < c.K / 8 ? incoming + 32n : null,
      sharedRow, sharedCol, arrayIndex, byteOffset: arrayIndex * 4, bank: arrayIndex % 32,
      unionByteOffset: (operand === "B" ? 8448 : 0) + arrayIndex * 4
    };
  }

  class Session {
    constructor(config = {}) {
      this.config = configure(config);
      this.phase = "ready";
      this.nextTile = 0;
      this.pending = null;
      this.stored = null;
      this.completedSlots = 0;
      this.loadedSlots = { A: 0, B: 0 };
      this.operand = "A";
      this.view = "global";
      this.pin = null;
    }
    get busy() { return this.phase === "loading" || this.phase === "storing"; }
    get canLoad() { return this.phase === "ready" && this.nextTile < this.config.K / 8; }
    get canStore() { return this.phase === "loaded"; }
    get displayTile() { return this.pending === null ? Math.min(this.nextTile, this.config.K / 8 - 1) : this.pending; }
    beginLoad() {
      if (!this.canLoad) return false;
      this.pending = this.nextTile;
      this.completedSlots = 0;
      this.loadedSlots = { A: 0, B: 0 };
      this.phase = "loading";
      return true;
    }
    finishLoad() {
      if (this.phase !== "loading") return false;
      this.completedSlots = 4;
      this.loadedSlots = { A: 4, B: 4 };
      this.phase = "loaded";
      return true;
    }
    beginStore() {
      if (!this.canStore) return false;
      this.phase = "storing";
      return true;
    }
    finishStore() {
      if (this.phase !== "storing") return false;
      this.stored = this.pending;
      this.pending = null;
      this.nextTile++;
      this.completedSlots = 0;
      this.loadedSlots = { A: 0, B: 0 };
      this.phase = "ready";
      return true;
    }
    setOperand(operand) {
      if (!["A", "B"].includes(operand)) throw new Error("Unknown operand.");
      this.operand = operand;
    }
    setView(view) {
      if (!["global", "shared"].includes(view)) throw new Error("Unknown view.");
      this.view = view;
    }
    setPin(t, i = null, source = "trace") {
      if (!Number.isInteger(t) || t < 0 || t > 255 || (i !== null && (!Number.isInteger(i) || i < 0 || i > 3)) ||
          !["trace", "shared"].includes(source)) throw new Error("Invalid pin.");
      this.pin = { t, i, source };
    }
  }

  function audit(c) {
    let checks = 0;
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
      checks++;
    };
    for (const operand of ["A", "B"]) {
      const seen = new Set();
      for (let t = 0; t < 256; t++) for (let i = 0; i < 4; i++) {
        const f = fragment(c, operand, t, i, 0);
        assert(!seen.has(f.arrayIndex), "Duplicate shared owner");
        seen.add(f.arrayIndex);
        assert(f.sharedRow < 8 && f.sharedCol < 128, "Padding write");
        assert(f.offset >= 0n && f.offset < BigInt(operand === "A" ? c.M : c.N) * BigInt(c.K), "Global range");
        assert(f.effective === f.incoming + BigInt(i) * f.fragmentStep, "Fragment step");
        assert(fragment(c, operand, t, i, 0, 1).arrayIndex === f.arrayIndex + 1056, "Stage offset");
        const last = fragment(c, operand, t, i, c.K / 8 - 1);
        assert(last.k < c.K && last.nextIncoming === null, "Last tile");
        if (c.K > 8) {
          const next = fragment(c, operand, t, i, 1);
          assert(next.effective - f.effective === 32n && next.arrayIndex === f.arrayIndex, "Tile advance");
        }
      }
      assert(seen.size === 1024 && seen.size * 4 === 4096, "Operand count");
      for (let row = 0; row < 8; row++) for (let col = 0; col < 132; col++) {
        assert(seen.has(row * 132 + col) === (col < 128), "Exact coverage");
      }
    }
    assert(2 * 256 * 4 * 4 === 8192, "Combined byte count");
    return { checks, message: "PASS · 1024 unique destinations / operand · 0 padding writes · 8192 bytes / Load" };
  }

  const api = { C, DEFAULTS, configure, fragment, Session, audit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TileMapping = api;
})(typeof globalThis === "undefined" ? this : globalThis);
