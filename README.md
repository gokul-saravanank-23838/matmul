# SIMT Atlas

Open `index.html` directly in a modern browser. No server, build, packages, or
network connection is needed.

The visualization follows global A/B loads, temporary registers, two shared
mainloop stages, two-slot warp operand buffers, persistent 8×8 accumulator
registers, and eight reordered epilogue exchanges through the **same shared
union allocation**, ending in `D = alpha * A * B`. There is no C input.

Use play, pause, step, speed, block/warp/lane selectors, K-step and epilogue
selectors. Click a value to pin its logical identity across views; hover or
keyboard-focus a cell for its value and address. Coordinate labels use x for
columns and y for rows. Numeric mode uses deterministic sample inputs.
Counters cover the selected block; outlined values and register views cover
the selected lane. Future output values are labeled as previews.

**Accuracy boundary:** the supplied conversation did not contain the flattened
kernel listing. The app therefore documents a representative 128×128 block,
8-deep K tile, 256-thread address mapping and safe barrier schedule, rather than
claiming exact equivalence to unavailable source. It assumes row-major,
unswizzled FP32 global storage; A is transposed when staged in shared memory
so both operands support contiguous vector loads. The original kernel is needed to verify or replace
these assumptions. The inline comments identify the modeled source phases.

The default two-tile run computes a K=16 partial product in a 4096×4096 address
space. Select 512 tiles for the full K=4096 product. Explanatory panels cover
double buffering, epilogue lane exchange, and the three PTX memory helpers.
Counts describe source payloads and operations, not cache traffic, cycles,
hardware scheduling, or measured performance.

The built-in **Self-test / mapping audit** runs on opening the page and when
changing K extent. It checks fragment coverage, accumulator ownership, shared
address reconstruction, vector-load contiguity/alignment and producer agreement,
epilogue permutation and contiguous output writes,
event counts, pipeline ordering, and numerical agreement with direct GEMM.
Use **Run again** after changing block selection to audit that block.