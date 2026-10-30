/* global TileMapping */
"use strict";
(() => {
  const { Session, fragment, audit } = TileMapping;
  const $ = (id) => document.getElementById(id);
  let session = new Session();
  let hover = null;
  let animationSlot = null;
  let animationOperand = null;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const colors = Array.from({ length: 32 }, (_, lane) =>
    `hsl(${(lane * 137.508) % 360} ${65 + (lane % 3) * 10}% ${62 + (lane % 2) * 12}%)`);
  const color = (t) => colors[t % 32];
  const hex = (n) => n === null ? "none · K exhausted" : `0x${n.toString(16).toUpperCase()}`;
  const fmt = (n) => n.toLocaleString("en-US");
  const f = (t, i, q = session.displayTile, operand = session.operand) => fragment(session.config, operand, t, i, q);
  const traceQ = (source) => source === "shared" ? session.stored : session.displayTile;
  const selection = () => hover || session.pin || { t: 0, i: null, source: "trace" };

  function detail(value) {
    return `${value.operand}(${value.coord}) · warp ${value.warp} lane ${value.lane} · t=${value.t} · subgroup ${value.subgroup}, subgroup lane ${value.subgroupLane}
fragment i=${value.i} · tile q=${value.q}
global float offset ${value.offset} · absolute byte address ${hex(value.effective)} (${value.effective})
shared physical ${value.sharedRow}.${value.sharedCol} · array float index ${value.arrayIndex} · byte offset ${value.byteOffset}
bank_idx=${value.bank} (bank-aligned array base) · union absolute byte offset ${value.unionByteOffset}`;
  }

  function cell(t, i, q, type) {
    const value = f(t, i, q);
    return `<button class="cell" data-t="${t}" data-i="${i}" data-source="${type}" style="--lane:${color(t)}" title="${detail(value)}" aria-label="${detail(value)}">${value.coord}</button>`;
  }

  function renderGlobal() {
    const c = session.config;
    const q = session.displayTile;
    const start = 8 * q;
    const origin = session.operand === "A" ? c.blockRow : c.blockColumn;
    const outerName = session.operand === "A" ? "m" : "n";
    $("global-description").textContent = session.operand === "A"
      ? "A(m,k) · row-major. Each thread reads four m coordinates, 32 rows apart, at the same k."
      : "B(k,n) · COLUMN-MAJOR. Each thread reads four n coordinates, 32 columns apart, at the same k.";
    $("matrix-label").textContent = session.operand === "A" ? "A · logical m ↓ / k →" : "B · physical-memory view: n ↓ / k →; cells remain logical k.n";
    $("slice-label").textContent = `q=${q} · k=${start}…${start + 7} / ${fmt(c.K)} · ${outerName}=${origin}…${origin + 127} of ${fmt(session.operand === "A" ? c.M : c.N)}`;
    const outerSize = session.operand === "A" ? c.M : c.N;
    const omitted = [];
    if (origin > 0) omitted.push(`${outerName}=0…${origin - 1}`);
    if (origin + 128 < outerSize) omitted.push(`${outerName}=${origin + 128}…${outerSize - 1}`);
    $("outer-omitted").textContent = omitted.length ? `Outside this block (omitted): ${omitted.join(" and ")}.` : "All outer coordinates are shown; none omitted outside this block.";
    let html = `<caption class="sr-only">${$("matrix-label").textContent}. Only current eight-wide K slice rendered; all 128 block outer coordinates.</caption><thead><tr><th scope="col">${outerName} ↓ / k →</th>`;
    if (start > 0) html += `<th scope="col" class="omitted">0…${start - 1}<br>omitted</th>`;
    for (let k = start; k < start + 8; k++) html += `<th scope="col">k ${k}</th>`;
    if (start + 8 < c.K) html += `<th scope="col" class="omitted">${start + 8}…${c.K - 1}<br>omitted</th>`;
    html += "</tr></thead><tbody>";
    for (let outer = 0; outer < 128; outer++) {
      html += `<tr><th scope="row">${outerName} ${origin + outer}</th>`;
      if (start > 0) html += '<td class="omitted">···</td>';
      for (let k = 0; k < 8; k++) html += `<td>${cell((outer % 32) * 8 + k, Math.floor(outer / 32), q, "trace")}</td>`;
      if (start + 8 < c.K) html += '<td class="omitted">···</td>';
      html += "</tr>";
    }
    $("global-matrix").innerHTML = html + "</tbody>";
  }

  function renderWarps() {
    let html = "";
    for (let warp = 0; warp < 8; warp++) {
      html += `<section class="warp" aria-label="Warp ${warp}"><div class="warp-title"><b>WARP ${warp}</b><span>t ${warp * 32}–${warp * 32 + 31} · 32 lanes</span></div>`;
      for (let group = 0; group < 4; group++) {
        html += `<div class="subgroup"><span class="group-label">SG ${group}<br>8 lanes</span>`;
        for (let j = 0; j < 8; j++) {
          const lane = group * 8 + j;
          const t = warp * 32 + lane;
          html += `<button class="lane" id="lane-${t}" data-t="${t}" data-source="trace" style="--lane:${color(t)}"><span class="lane-id">L${lane}</span><span class="thread-id">t${t}</span><span class="slots">`;
          for (let i = 0; i < 4; i++) html += `<span class="slot" data-t="${t}" data-i="${i}" data-source="trace">i${i}</span>`;
          html += "</span></button>";
        }
        html += "</div>";
      }
      html += "</section>";
    }
    $("warps").innerHTML = html;
    updateLaneTitles();
  }

  function updateLaneTitles() {
    for (let t = 0; t < 256; t++) {
      const a = f(t, 0, session.displayTile, "A");
      const b = f(t, 0, session.displayTile, "B");
      const values = Array.from({ length: 4 }, (_, i) => detail(f(t, i)));
      const title = `Warp ${a.warp} · lane ${a.lane} · subgroup ${a.subgroup} · subgroup lane ${a.subgroupLane} · block thread ${t}
incoming a_address=${hex(a.incoming)}; b_address=${hex(b.incoming)}
next-call A=${hex(a.nextIncoming)}; B=${hex(b.nextIncoming)}
${values.join("\n\n")}`;
      const lane = $(`lane-${t}`);
      lane.title = title;
      lane.setAttribute("aria-label", title);
    }
  }

  function renderShared() {
    const op = session.operand;
    const q = session.stored;
    $("shared-description").textContent = `${op === "A" ? "A(m,k)" : "B(k,n) · column-major source"} → separate ${op} shared array. Physical rows are localK; columns are local ${op === "A" ? "m" : "n"}, not global coordinates.`;
    $("shared-label").textContent = `${op} shared · stage 0 · 8 × 132 · ${q === null ? "empty · no Store yet" : `latest stored q=${q}`}`;
    let html = `<caption class="sr-only">${op} shared physical stage zero: localK rows zero through seven, columns zero through 131. Columns 128–131 are padding.</caption><thead><tr><th scope="col">localK ↓ / col →</th>`;
    for (let col = 0; col < 132; col++) html += `<th scope="col">${col < 128 ? `col ${col}` : `PAD ${col}`}</th>`;
    html += "</tr></thead><tbody>";
    let overview = "";
    for (let row = 0; row < 8; row++) {
      html += `<tr><th scope="row">row ${row}</th>`;
      for (let col = 0; col < 132; col++) {
        const pad = col >= 128;
        const t = (col % 32) * 8 + row;
        const i = Math.floor(col / 32);
        html += pad ? `<td><span class="padding" title="Padding · no owner · never written · index ${row * 132 + col}">PAD<br>${row}.${col}</span></td>`
          : q === null ? `<td><span class="empty" title="Empty · physical ${row}.${col} · no Store yet">empty</span></td>` : `<td>${cell(t, i, q, "shared")}</td>`;
        overview += pad ? '<span class="mini pad" title="Padding · never written"></span>'
          : `<button class="mini${q === null ? "" : " written"}" style="--lane:${color(t)}" data-pan="${col}" ${q === null ? "" : `data-t="${t}" data-i="${i}" data-source="shared"`} tabindex="-1" aria-hidden="true" title="Physical ${row}.${col}${q === null ? " · empty" : ` · ${f(t, i, q).coord}`}"></button>`;
      }
      html += "</tr>";
    }
    $("shared-matrix").innerHTML = html + "</tbody>";
    $("shared-overview").innerHTML = overview;
  }

  function renderStatus() {
    const busy = session.busy;
    $("load").disabled = !session.canLoad;
    $("store").disabled = !session.canStore;
    $("step").disabled = !session.canLoad && !session.canStore;
    $("step").textContent = session.canStore ? "Step: Store →" : "Step: Load →";
    $("reset").disabled = busy;
    for (const element of $("settings").elements) element.disabled = busy;
    $("lifecycle").innerHTML = ["ready", "loading", "loaded", "storing"].map((phase) =>
      session.phase === phase ? `<strong>${phase.toUpperCase()}</strong>` : phase.toUpperCase()).join(" → ");
    const pending = session.pending;
    $("tile-status").textContent = `Pending registers: ${pending === null ? "none" : `q=${pending}`} · Latest shared: ${session.stored === null ? "empty" : `q=${session.stored}`} · Next Load: ${session.nextTile < session.config.K / 8 ? `q=${session.nextTile}` : "none · K complete"}`;
    const slots = session.loadedSlots[session.operand];
    document.querySelectorAll(".slot").forEach((slot) => {
      const i = Number(slot.dataset.i);
      slot.classList.toggle("filled", session.pending !== null && i < slots);
      slot.classList.toggle("transferring", animationSlot === i && animationOperand === session.operand);
    });
    $("store-slots").innerHTML = Array.from({ length: 4 }, (_, i) =>
      `<div id="store-slot-${i}" class="store-slot${session.pending !== null && i < slots ? " filled" : ""}${animationSlot === i && animationOperand === session.operand ? " transferring" : ""}">i${i}<br>${session.pending !== null && i < slots ? "256 floats" : "empty"}</div>`).join("");
    $("global-screen").hidden = session.view !== "global";
    $("shared-screen").hidden = session.view !== "shared";
    $("global-tab").setAttribute("aria-pressed", String(session.view === "global"));
    $("shared-tab").setAttribute("aria-pressed", String(session.view === "shared"));
    $("operand-a").setAttribute("aria-pressed", String(session.operand === "A"));
    $("operand-b").setAttribute("aria-pressed", String(session.operand === "B"));
    renderTrace();
  }

  function renderTrace() {
    const picked = selection();
    const q = traceQ(picked.source);
    if (q === null) {
      $("trace").textContent = "Shared memory is empty. Load and Store a block to inspect its owners.";
      highlight();
      return;
    }
    const v = f(picked.t, 0, q);
    const a = f(picked.t, 0, q, "A");
    const b = f(picked.t, 0, q, "B");
    const state = picked.source === "shared" ? `STORED · q=${q}` :
      session.pending === null ? `SOURCE PREVIEW · q=${q} · registers empty` :
        `${session.phase === "loading" ? "LOADING" : session.phase === "storing" ? "STORING" : "LOADED"} · q=${q}`;
    let html = `<div class="trace-summary"><h2>Warp ${v.warp} <span style="color:${color(v.t)}">/ Lane ${v.lane}</span></h2>
      <span class="badge">${hover ? "HOVER" : session.pin ? "PINNED" : "PREVIEW"} · ${state}</span>
      <p>t = 32 × ${v.warp} + ${v.lane} = <b>${v.t}</b><br>subgroup ${v.subgroup} · subgroup lane ${v.subgroupLane}<br>first = ${v.first} · localK = ${v.localK}</p>
      <p class="explanation">${session.operand === "A" ? "A(m,k), row-major" : "B(k,n), COLUMN-MAJOR; offset = n × K + k"}. Coordinates below are logical row.col. Simulated absolute byte addresses (hex and decimal); no dereference.</p>
      <dl><dt>Incoming a_address / b_address · q=${q}</dt><dd>A ${hex(a.incoming)} (${a.incoming})<br>B ${hex(b.incoming)} (${b.incoming})</dd>
      <dt>Next-call incoming addresses · ${a.nextIncoming === null ? "no real tile" : `q=${q + 1}; +32 bytes`}</dt><dd>A ${hex(a.nextIncoming)}${a.nextIncoming === null ? "" : ` (${a.nextIncoming})`}<br>B ${hex(b.nextIncoming)}${b.nextIncoming === null ? "" : ` (${b.nextIncoming})`}</dd>
      <dt>FRAGMENT_STEP_BYTES = 32 × K × 4</dt><dd>${v.fragmentStep} bytes</dd></dl></div>`;
    for (let i = 0; i < 4; i++) {
      const value = f(picked.t, i, q);
      const av = f(picked.t, i, q, "A");
      const bv = f(picked.t, i, q, "B");
      const loaded = session.pending === q && i < session.loadedSlots[session.operand];
      html += `<div class="fragment-card${picked.i === i ? " selected" : ""}" style="--lane:${color(v.t)}">
      <button data-pin-slot="${i}" aria-label="Pin fragment ${i} of thread ${v.t}">Pin i${i}</button><strong>i${i} · ${session.operand}(${value.coord})</strong><br>
      ${picked.source === "shared" ? "Stored value" : loaded ? "Register populated" : "Source preview · register empty"}
      <dl><dt>Global element offset (${session.operand})</dt><dd>${value.offset}</dd>
      <dt>Effective absolute byte addresses</dt><dd>A(${av.coord}) ${hex(av.effective)} (${av.effective})<br>B(${bv.coord}) ${hex(bv.effective)} (${bv.effective})</dd>
      <dt>${picked.source === "shared" ? "Physical shared" : "Eventual physical shared"} row.col / float index</dt><dd>${value.sharedRow}.${value.sharedCol} / ${value.arrayIndex}</dd>
      <dt>Array-relative bytes / bank_idx</dt><dd>${value.byteOffset} / ${value.bank} (aligned base)</dd>
      <dt>Original union absolute byte offset (${session.operand})</dt><dd>${value.unionByteOffset}</dd></dl></div>`;
    }
    $("trace").innerHTML = html;
    highlight();
  }

  function highlight() {
    document.querySelectorAll(".trace, .pinned").forEach((el) => el.classList.remove("trace", "pinned"));
    const picked = selection();
    const q = traceQ(picked.source);
    document.querySelectorAll(`[data-t="${picked.t}"]`).forEach((el) => {
      const source = el.dataset.source;
      const sameTile = el.classList.contains("lane") || el.classList.contains("slot") ||
        (source === "shared" ? session.stored === q : session.displayTile === q);
      if (sameTile && (picked.i === null || !el.hasAttribute("data-i") || Number(el.dataset.i) === picked.i)) el.classList.add("trace");
    });
    if (session.pin) {
      const { t, i, source } = session.pin;
      const root = source === "shared" ? $("shared-matrix") : $("global-matrix");
      root.querySelectorAll(`[data-t="${t}"]`).forEach((el) => {
        if (i === null || Number(el.dataset.i) === i) el.classList.add("pinned");
      });
      $(`lane-${t}`).classList.add("pinned");
    }
  }

  function runAudit() {
    try {
      const result = audit(session.config);
      $("audit-result").textContent = `${result.message} · ${fmt(result.checks)} checks.`;
    } catch (error) {
      $("audit-result").textContent = `FAIL · ${error.message}`;
    }
  }

  function renderAll() {
    hover = null;
    renderGlobal();
    renderShared();
    if (!$("warps").children.length) renderWarps();
    else updateLaneTitles();
    renderStatus();
  }

  function visibleRect(el, container) {
    if (!el || !el.getClientRects().length || !container.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    if (r.bottom < c.top || r.top > c.bottom || r.right < c.left || r.left > c.right) return null;
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    return r;
  }

  async function fly(kind, i, operand) {
    const duration = motion.matches ? 0 : 400 / Number($("speed").value);
    animationSlot = i;
    animationOperand = operand;
    renderStatus();
    const animations = [];
    if (duration && operand === session.operand) {
      for (let t = 0; t < 256; t++) {
        const lane = $(`lane-${t}`);
        const slot = lane.querySelector(`[data-i="${i}"]`);
        const globalCell = $("global-matrix").querySelector(`[data-t="${t}"][data-i="${i}"]`);
        const sharedCell = $("shared-matrix").querySelector(`[data-t="${t}"][data-i="${i}"]`);
        let start;
        let end;
        if (kind === "load" && session.view === "global") {
          end = visibleRect(slot, $("warps"));
          start = visibleRect(globalCell, $("global-scroll"));
          if (end && !start) {
            const r = $("global-scroll").getBoundingClientRect();
            start = { left: end.left, top: r.bottom - 20 };
          }
        } else if (kind === "store" && session.view === "shared") {
          // Empty cells have no owner; locate the physical destination directly.
          const value = f(t, i, session.pending, operand);
          const target = sharedCell || $("shared-matrix").tBodies[0].rows[value.sharedRow].cells[value.sharedCol + 1].firstElementChild;
          end = visibleRect(target, $("shared-scroll"));
          if (end) {
            const r = $(`store-slot-${i}`).getBoundingClientRect();
            start = { left: r.left + (t / 256) * r.width, top: r.bottom };
          }
        } else if (kind === "store" && session.view === "global") {
          start = visibleRect(slot, $("warps"));
          if (start) {
            const r = $("shared-tab").getBoundingClientRect();
            end = { left: r.left, top: r.bottom };
          }
        }
        if (start && end) {
          const particle = document.createElement("span");
          particle.className = "flight";
          particle.style.setProperty("--lane", color(t));
          particle.textContent = `i${i} ${f(t, i, session.pending, operand).coord}`;
          particle.style.left = `${start.left}px`;
          particle.style.top = `${start.top}px`;
          $("flights").append(particle);
          const animation = particle.animate([
            { transform: "translate(0,0) scale(.8)", opacity: .8 },
            { transform: `translate(${end.left - start.left}px,${end.top - start.top}px) scale(1)`, opacity: 1 }
          ], { duration, easing: "ease-in-out", fill: "forwards" });
          animations.push(animation.finished.catch(() => {}).then(() => particle.remove()));
        }
      }
    }
    await Promise.all([...animations, new Promise((resolve) => setTimeout(resolve, duration))]);
  }

  async function load() {
    if (!session.beginLoad()) return;
    hover = null;
    renderGlobal();
    updateLaneTitles();
    renderStatus();
    // Source order is per thread: all four A loads, then all four B loads.
    // This serial teaching animation makes no claim about scheduling across warps.
    for (const operand of ["A", "B"]) for (let i = 0; i < 4; i++) {
      await fly("load", i, operand);
      session.loadedSlots[operand] = i + 1;
      renderStatus();
    }
    animationSlot = animationOperand = null;
    session.finishLoad();
    renderStatus();
    $("announcement").textContent = "Loaded both operands: 2048 floats, 8192 bytes. Store is now available.";
  }

  async function store() {
    if (!session.beginStore()) return;
    hover = null;
    renderStatus();
    for (let i = 0; i < 4; i++) await fly("store", i, session.operand);
    animationSlot = animationOperand = null;
    session.finishStore();
    // Keep old source slice in the DOM until rebuilding it with the next real preview.
    renderAll();
    $("announcement").textContent = `Stored tile ${session.stored} in both shared arrays. ${session.canLoad ? "Ready for the next Load." : "K complete; no further tile."}`;
  }

  function reset(config = session.config) {
    if (session.busy) return;
    const operand = session.operand;
    const view = session.view;
    session = new Session(config);
    session.setOperand(operand);
    session.setView(view);
    renderAll();
    runAudit();
  }

  $("load").addEventListener("click", load);
  $("store").addEventListener("click", store);
  $("step").addEventListener("click", () => session.canStore ? store() : load());
  $("reset").addEventListener("click", () => reset());
  for (const view of ["global", "shared"]) $(`${view}-tab`).addEventListener("click", () => {
    session.setView(view);
    hover = null;
    renderStatus();
  });
  for (const operand of ["A", "B"]) $(`operand-${operand.toLowerCase()}`).addEventListener("click", () => {
    session.setOperand(operand);
    renderAll();
  });
  $("speed").addEventListener("input", () => { $("speed-value").value = `${$("speed").value}×`; });
  $("zoom").addEventListener("input", () => { document.documentElement.style.setProperty("--cell-width", `${$("zoom").value}px`); });
  $("settings-toggle").addEventListener("click", () => {
    $("settings").hidden = !$("settings").hidden;
    $("settings-toggle").setAttribute("aria-expanded", String(!$("settings").hidden));
  });
  $("settings").addEventListener("submit", (event) => {
    event.preventDefault();
    if (session.busy) return;
    try {
      const candidate = new Session(Object.fromEntries(new FormData($("settings"))));
      reset(candidate.config);
      $("parameter-error").textContent = "";
    } catch (error) {
      $("parameter-error").textContent = error.message;
    }
  });
  $("audit").addEventListener("click", runAudit);
  function clearPin() {
    session.pin = null;
    hover = null;
    renderTrace();
  }
  $("clear-pin").addEventListener("click", clearPin);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") clearPin(); });

  function pickedFrom(target) {
    const el = target.closest("[data-t]");
    return el ? { t: Number(el.dataset.t), i: el.hasAttribute("data-i") ? Number(el.dataset.i) : null, source: el.dataset.source } : null;
  }
  for (const id of ["global-matrix", "warps", "shared-matrix", "shared-overview"]) {
    const root = $(id);
    function inspect(event) {
      const picked = pickedFrom(event.target);
      if (!picked || (hover && picked.t === hover.t && picked.i === hover.i && picked.source === hover.source)) return;
      hover = picked;
      renderTrace();
    }
    root.addEventListener("pointerover", inspect);
    root.addEventListener("focusin", inspect);
    root.addEventListener("pointerleave", () => { hover = null; renderTrace(); });
    root.addEventListener("focusout", (event) => {
      if (!root.contains(event.relatedTarget)) { hover = null; renderTrace(); }
    });
    root.addEventListener("click", (event) => {
      const pan = event.target.closest("[data-pan]");
      if (pan) {
        const header = $("shared-matrix").tHead.rows[0].cells[Number(pan.dataset.pan) + 1];
        $("shared-scroll").scrollLeft = header.offsetLeft - $("shared-matrix").tHead.rows[0].cells[0].offsetWidth;
      }
      const picked = pickedFrom(event.target);
      if (picked) {
        session.setPin(picked.t, picked.i, picked.source);
        hover = null;
        renderTrace();
      }
    });
  }
  $("trace").addEventListener("click", (event) => {
    const button = event.target.closest("[data-pin-slot]");
    if (!button) return;
    const picked = selection();
    session.setPin(picked.t, Number(button.dataset.pinSlot), picked.source);
    hover = null;
    renderTrace();
  });
  renderAll();
  runAudit();
})();
