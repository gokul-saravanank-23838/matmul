# matmul

## CUDA memory atlas

Open **[index.html](index.html)** directly in a modern browser. No dependencies,
build step, network requests, or GPU are needed. For an HTTP preview:

```sh
python3 -m http.server 8000 --directory /path/to/matmul
```

Then open `http://localhost:8000`. The app uses BigInt and the Web Animations API.

### Walkthrough

1. **GLOBAL READ** shows the current eight-wide K slice and all 128 outer
   coordinates (scroll vertically), plus eight warps (scroll the warp deck in
   both directions). Each warp contains four visibly separated eight-lane
   **addressing groups**, not independent execution units. Lane labels/colors
   repeat across warps; warp, lane, subgroup, subgroup lane, and block thread
   `t = 32*warp + lane` identify ownership.
2. **Load block** invokes the whole-block `load_input_tile` model once:
   **256 threads × four floats = 1024 floats / 4096 bytes per operand**;
   **A+B = 2048 floats / 8192 bytes**. All four A slots then all four B slots
   populate in that one click. Both operands progress even when hidden.
3. Switch **A / B** to change the entire displayed mapping. A is mathematical
   `A(m,k)`, row-major. B is mathematical `B(k,n)`, **column-major**:
   its float offset is `n*K+k`, not `k*N+n`. B's matrix view explicitly uses
   physical axes `n` vertically and `k` horizontally while keeping cell labels
   in logical `k.n` order.
4. **SHARED WRITE** is a separate full-page workspace, not a simultaneous
   mini-panel. **Store block** moves all loaded registers to separate A/B shared
   arrays. The four source bands each represent 256 scalar register slots.
   The overview pans the detailed horizontally scrolling table, which includes
   **all 132 columns**, sticky physical headers, adjustable cell width, and
   source logical `row.col` labels. Empty slots differ from striped padding.
5. Hover/focus a lane or cell to inspect it. Click/tap to pin; Enter/Space on a
   focused button also pins. A lane pin traces all four fragments; a cell or
   register slot pins one value. The inspector's **Pin i0…i3** buttons provide
   keyboard access to individual register slots. A pinned owner persists across
   view and operand switches. Hover temporarily previews another owner;
   **Unpin** or Escape clears the pin. Shared hover reverse-highlights its owner;
   global values highlight only when their tile matches the inspected tile.
6. **Step** performs the next valid Load or Store. Invalid actions, Reset, and
   parameter application are locked during animations; another Load is blocked
   until Store finishes. Speed, views, and operand selection remain available.
   Reduced-motion preferences suppress moving particles and delays.

The persistent inspector includes both incoming `a_address` and `b_address`,
all four effective addresses for **both** operands, fragment step, next-call
incoming addresses, logical coordinates, global float offsets, shared physical
row/column, float index, array-relative byte offset, bank index, and original
union absolute byte offset. Addresses are exact BigInt hex/decimal values.
All bases are **simulated**, including zero as an offset convention; nothing
is actually dereferenced.

### Parameters and lifecycle

Defaults: M=N=K=4096, logical block origins 0, BLOCK_M=BLOCK_N=128, BLOCK_K=8,
256 threads, four fragments. **Parameters** accepts M/N, positive K divisible by
8 (including K=8), logical block row/column origins, and unsigned 64-bit A/B
base addresses in decimal or hex. Origins are element coordinates, not CUDA
block indices. The entire 128×128 block must fit M×N. Dimensions/origins must be
safe integers; simulated matrices must fit the 64-bit address space.
**Apply & reset** validates everything before replacing state.
**Reset** restarts the applied configuration, keeping the view, operand, speed,
and table cell size; it clears the pin and pending/stored tiles.

`Ready → Load (animation) → Loaded → Store (animation) → Ready`

Pending registers and latest stored shared tile have separate labels. A new
Load does **not** relabel old shared data. Each Store atomically publishes the
new tile at animation completion. Incoming addresses advance by 32 bytes per
tile; the same shared destinations are overwritten. There is no extra tile
beyond K; at K=8 only q=0 can load.

This is deliberately **single-stage serial pedagogy**, not a claim that the
original double-buffered kernel cannot overlap loads and computation. Only
stage 0 is displayed: 8×132 = 1056 float slots, including four never-written
padding columns per row. The original arrays each have 2×8×132 = 2112 slots.
The model/audit also verifies stage 1's +1056 float offset.

### Exact mapping

For `t=0…255`, `first=floor(t/8)`, `localK=t%8`, `k=8*q+localK`,
and `i=0…3`:

| Field | A | B |
|---|---|---|
| Logical coordinates | `(blockRow+first+32*i, k)` | `(k, blockColumn+first+32*i)` |
| Global float offset | `m*K+k` | `n*K+k` |
| Incoming byte address | `A_base+4*((blockRow+first)*K+k)` | `B_base+4*((blockColumn+first)*K+k)` |
| Effective byte address | `a_address+i*(32*K*4)` | `b_address+i*(32*K*4)` |
| Shared physical row | `stage*8+localK` | same |
| Shared physical column | `first+32*i` | same |
| Array float index | `physicalRow*132+sharedColumn` | same |
| Array byte offset | `arrayIndex*4` | same |

This is **not** an XOR swizzle or a conventional substitute transpose.
Relative `bank_idx=arrayIndex%32` assumes a bank-aligned array base. Original
B storage begins 2112×4 = **8448 bytes** after A; 2112 is divisible by 32, so
both arrays have the same relative bank pattern. **Union absolute byte offset**
and **array-relative byte offset** are separately named. A bank index alone is
not proof of a conflict: concurrent instruction accesses, broadcasts, and
instruction width matter.

Animations describe **source-level data mappings, not GPU cycles**. Within
each thread the four A scalar loads precede the four B loads; no ordering
across warps is asserted. Offscreen values update alongside visible particles.
Mainloop arithmetic, cache behavior, and hardware prefetching are excluded.
No CUDA GEMM or C implementation is added or modified.

### Verification

Run the dependency-free automated tests using Node 18 or newer:

```sh
node --test mapping.test.js
node --check mapping.js
node --check app.js
```

The tests cover the supplied K=8 examples (t0/t1/t8/t255), independent exhaustive
A/B formulas at shifted origins, every destination in both stages, zero padding
writes, counts, global range, exact 64-bit addresses, q advancement and
exhaustion, invalid parameters, lifecycle/action locks, pending vs stored tiles,
and pin/view/operand persistence. **Run audit** in the inspector independently
checks the applied configuration and reports its check count.

Browser smoke procedure:

- Apply K=8, zero bases: pin t0; check A `0.0,32.0,64.0,96.0`, B
  `0.0,0.32,0.64,0.96`, offsets `0,256,512,768`, byte addresses
  `0,1024,2048,3072`, shared indices `0,32,64,96`.
- Load once: verify all four slots of all 256 threads populate, Load locks,
  Store unlocks, switching views/operands preserves the pin. Store once:
  verify 1024 owned cells, 32 empty padding cells, no further Load.
- Apply K=16: Store q0 then Load q1; old shared cells must still say q0 until
  Store completes. Inspect t255 and physical last-row padding indices
  1052…1055. Pan to columns 128…131.
- Try invalid K/origins/addresses without losing current state. Test keyboard
  focus, Enter/Space pinning, Escape, reduced motion, narrow touch layout,
  speed, reset, and local `file://` opening.