/* 航标灯质可辨性预检台 —— 原生 JavaScript 前端 */
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';

const state = {
  draft: { lights: [], W: 40, k: 0 },
  lastResult: null, // {id, config, result} 最新分析
};

/* ---------- 通用工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && data.detail
      ? (Array.isArray(data.detail) ? data.detail.join('\n') : data.detail)
      : `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data;
}

/* ---------- Tab 切换 ---------- */
$$('.tab').forEach((btn) => btn.addEventListener('click', () => {
  $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  const name = btn.dataset.tab;
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'history') loadHistory();
}));

/* ---------- 校验（与后端 analyzer.validate_config 规则一致） ---------- */
function lightLabel(l, i) {
  return l.name && l.name.trim() ? l.name.trim() : `灯 ${i + 1}`;
}

function validateDraft(d) {
  const errors = [];
  if (!(d.lights.length >= 2 && d.lights.length <= 20))
    errors.push(`灯的数量必须在 2～20 之间（当前 ${d.lights.length} 盏）`);

  d.lights.forEach((l, i) => {
    const label = lightLabel(l, i);
    const code = l.code;
    if (typeof code !== 'string' || code.length < 2 || code.length > 80)
      errors.push(`「${esc(label)}」灯串长度必须在 2～80 位（当前 ${String(code).length} 位）`);
    else {
      if ([...code].some((ch) => ch !== '0' && ch !== '1'))
        errors.push(`「${esc(label)}」灯串只能包含字符 0 和 1`);
      if (!code.includes('0') || !code.includes('1'))
        errors.push(`「${esc(label)}」灯串必须同时包含 0 和 1`);
    }
  });

  if (!Number.isInteger(d.W) || d.W < 1 || d.W > 400)
    errors.push('观测窗口上限 W 必须是 1～400 的整数');
  if (!Number.isInteger(d.k) || d.k < 0 || d.k > 3)
    errors.push('每段最多误判位数 k 必须是 0～3 的整数');
  return errors;
}

/* ---------- 草稿 ---------- */
let saveTimer = null;
function persistDraft() {
  clearTimeout(saveTimer);
  $('#save-state').textContent = '保存中…';
  saveTimer = setTimeout(async () => {
    try {
      await api('PUT', '/api/draft', state.draft);
      $('#save-state').textContent = '草稿已保存 ' + new Date().toLocaleTimeString();
    } catch {
      $('#save-state').textContent = '草稿保存失败';
    }
  }, 350);
}

/* ---------- 编辑器表格 ---------- */
function renderEditor() {
  const tbody = $('#lights-tbody');
  tbody.innerHTML = '';
  state.draft.lights.forEach((light, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td class="col-idx">${i + 1}</td>
      <td class="col-name"><input type="text" class="name-input" maxlength="20"
          value="${esc(light.name)}" placeholder="灯 ${i + 1}" /></td>
      <td><input type="text" class="code-input" inputmode="numeric"
          value="${esc(light.code)}" placeholder="例如 11010" /></td>
      <td class="col-preview"><div class="mini-wave"></div></td>
      <td class="col-op"><button class="icon-btn" title="删除这盏灯"
          ${state.draft.lights.length <= 2 ? 'disabled style="opacity:.3"' : ''}>✕</button></td>`;
    tbody.appendChild(tr);
    drawMiniWave($('.mini-wave', tr), light.code);
    markRowValid(tr, light, i);
  });
  $('#param-W').value = state.draft.W;
  $('#param-k').value = state.draft.k;
  $('#lights-count').textContent = `${state.draft.lights.length} 盏灯（需 2～20）`;
  $('#errors').innerHTML = '';
}

function markRowValid(tr, light, i) {
  const code = light.code;
  const bad = !(code.length >= 2 && code.length <= 80 &&
    /^[01]*$/.test(code) && code.includes('0') && code.includes('1'));
  $('.code-input', tr).classList.toggle('invalid', bad);
}

$('#lights-tbody').addEventListener('input', (e) => {
  const tr = e.target.closest('tr');
  const idx = Number(tr.dataset.idx);
  if (e.target.classList.contains('name-input')) {
    state.draft.lights[idx].name = e.target.value;
  } else if (e.target.classList.contains('code-input')) {
    state.draft.lights[idx].code = e.target.value;
    drawMiniWave($('.mini-wave', tr), e.target.value);
    markRowValid(tr, state.draft.lights[idx], idx);
  }
  persistDraft();
});

$('#lights-tbody').addEventListener('click', (e) => {
  if (!e.target.classList.contains('icon-btn')) return;
  if (state.draft.lights.length <= 2) return;
  const idx = Number(e.target.closest('tr').dataset.idx);
  state.draft.lights.splice(idx, 1);
  renderEditor();
  persistDraft();
});

$('#add-light').addEventListener('click', () => {
  if (state.draft.lights.length >= 20) return;
  state.draft.lights.push({ name: `灯 ${String.fromCharCode(65 + state.draft.lights.length)}`, code: '10' });
  renderEditor();
  persistDraft();
});

$('#param-W').addEventListener('input', (e) => {
  state.draft.W = parseInt(e.target.value, 10);
  persistDraft();
});
$('#param-k').addEventListener('input', (e) => {
  state.draft.k = parseInt(e.target.value, 10);
  persistDraft();
});

/* ---------- 波形绘制 ---------- */
const COLOR = {
  on: '#f0a51f', onStroke: '#b97a0c',
  off: '#e9ecef', offStroke: '#c2c8cf',
  bad: 'rgba(210,59,59,.18)', badStroke: '#d23b3b',
  grid: '#e6e9ed', text: '#6b7686',
};

function drawMiniWave(container, code) {
  container.innerHTML = '';
  if (!code || ![...code].every((c) => c === '0' || c === '1')) return;
  const n = code.length, cw = 9, h = 16;
  const svg = svgEl('svg', { class: 'wave', width: n * cw, height: h, viewBox: `0 0 ${n * cw} ${h}` });
  svgEl('title', {}, svg).textContent = code;
  [...code].forEach((bit, t) => {
    svgEl('rect', {
      x: t * cw + 0.5, y: 1, width: cw - 1, height: h - 2, rx: 2,
      fill: bit === '1' ? COLOR.on : COLOR.off,
      stroke: bit === '1' ? COLOR.onStroke : COLOR.offStroke, 'stroke-width': 0.8,
    }, svg);
  });
  container.appendChild(svg);
}

/** 前 n 位循环波形（单盏灯总览） */
function drawCyclicWave(container, code, n) {
  container.innerHTML = '';
  const cw = 3, h = 18;
  const svg = svgEl('svg', { class: 'wave', width: n * cw, height: h, viewBox: `0 0 ${n * cw} ${h}` });
  for (let t = 0; t < n; t++) {
    const bit = code[t % code.length];
    svgEl('rect', {
      x: t * cw, y: 1, width: cw, height: h - 2,
      fill: bit === '1' ? COLOR.on : COLOR.off,
    }, svg);
    // 周期分界
    if (t > 0 && t % code.length === 0)
      svgEl('line', { x1: t * cw, y1: 0, x2: t * cw, y2: h, stroke: '#b9c0c9', 'stroke-width': 0.7 }, svg);
  }
  container.appendChild(svg);
}

/** 逐位见证波形：两行灯串 + 差异列高亮 + 位置刻度 */
function drawWitnessWave(container, nameA, nameB, bitsA, bitsB, mismatchSet) {
  container.innerHTML = '';
  const n = bitsA.length;
  const cw = 11, h = 16, labelW = 78;
  const rulerH = 16, top = 2;
  const rowAY = rulerH, rowBY = rulerH + h + 3;
  const width = labelW + n * cw + 2;
  const height = rowBY + h + 4;
  const svg = svgEl('svg', { class: 'wave', width, height, viewBox: `0 0 ${width} ${height}` });

  const xOf = (t) => labelW + t * cw;

  // 刻度：每 10 位
  for (let t = 0; t < n; t += 10) {
    const x = xOf(t);
    svgEl('line', { x1: x, y1: rulerH - 3, x2: x, y2: height - 2, stroke: COLOR.grid, 'stroke-width': 1 }, svg);
    const tx = svgEl('text', { x: x + 1, y: rulerH - 5, 'font-size': 9, fill: COLOR.text }, svg);
    tx.textContent = t + 1;
  }

  const drawRow = (bits, y, name) => {
    const tnode = svgEl('text', { x: 4, y: y + h - 4, 'font-size': 10.5, fill: '#374151' }, svg);
    tnode.textContent = name.length > 9 ? name.slice(0, 8) + '…' : name;
    [...bits].forEach((bit, t) => {
      const bad = mismatchSet.has(t + 1);
      svgEl('rect', {
        x: xOf(t) + 1, y: y + 1, width: cw - 2, height: h - 2, rx: 2,
        fill: bit === '1' ? COLOR.on : COLOR.off,
        stroke: bad ? COLOR.badStroke : (bit === '1' ? COLOR.onStroke : COLOR.offStroke),
        'stroke-width': bad ? 1.2 : 0.7,
      }, svg);
    });
  };
  drawRow(bitsA, rowAY, nameA);
  drawRow(bitsB, rowBY, nameB);

  // 差异列：红色竖向贯穿标记
  [...mismatchSet].forEach((pos) => {
    const t = pos - 1;
    const r = svgEl('rect', {
      x: xOf(t), y: rowAY - 1, width: cw, height: h * 2 + 5,
      fill: COLOR.bad, 'pointer-events': 'all',
    }, svg);
    svgEl('title', {}, r).textContent =
      `第 ${pos} 位：${nameA}=${bitsA[t]}，${nameB}=${bitsB[t]}`;
  });

  container.appendChild(svg);
}

/** 最小距离曲线 d(n)，阈值线 2k，可辨点标记 */
function drawSparkline(container, curve, threshold, markN) {
  container.innerHTML = '';
  const w = 300, h = 52, padL = 26, padR = 10, padT = 8, padB = 14;
  const W = curve.length;
  const dMax = Math.max(...curve, threshold, 1);
  const xOf = (n) => padL + ((n - 1) / Math.max(W - 1, 1)) * (w - padL - padR);
  const yOf = (d) => padT + (1 - d / dMax) * (h - padT - padB);
  const svg = svgEl('svg', { class: 'wave', width: w, height: h, viewBox: `0 0 ${w} ${h}` });

  // 网格与纵轴标签
  [0, dMax].forEach((d) => {
    const y = yOf(d);
    svgEl('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: COLOR.grid }, svg);
    const t = svgEl('text', { x: 4, y: y + 3, 'font-size': 9, fill: COLOR.text }, svg);
    t.textContent = d;
  });

  // 阈值线 2k
  const yt = yOf(threshold);
  svgEl('line', {
    x1: padL, y1: yt, x2: w - padR, y2: yt,
    stroke: COLOR.badStroke, 'stroke-dasharray': '4 3', 'stroke-width': 1,
  }, svg);
  const tt = svgEl('text', { x: w - padR, y: yt - 2, 'font-size': 9, fill: COLOR.badStroke, 'text-anchor': 'end' }, svg);
  tt.textContent = `2k=${threshold}`;

  // 阶梯线（距离随 n 非递减）
  let path = '';
  curve.forEach((d, i) => {
    const n = i + 1;
    path += `${n === 1 ? 'M' : 'L'}${xOf(n).toFixed(1)},${yOf(d).toFixed(1)} `;
  });
  svgEl('path', { d: path, fill: 'none', stroke: '#1a6fb0', 'stroke-width': 1.5 }, svg);

  // n 轴标签
  [1, W].forEach((n) => {
    const t = svgEl('text', {
      x: xOf(n), y: h - 3, 'font-size': 9, fill: COLOR.text,
      'text-anchor': n === 1 ? 'start' : 'end',
    }, svg);
    t.textContent = `n=${n}`;
  });

  // 该对的首次可辨点
  if (markN != null) {
    const x = xOf(markN);
    svgEl('line', { x1: x, y1: padT, x2: x, y2: h - padB, stroke: '#1e8a4c', 'stroke-dasharray': '2 2' }, svg);
    svgEl('circle', { cx: x, cy: yOf(curve[markN - 1]), r: 3, fill: '#1e8a4c' }, svg);
    const t = svgEl('text', { x: x + 3, y: padT + 8, 'font-size': 9, fill: '#1e8a4c' }, svg);
    t.textContent = markN;
  }
  container.appendChild(svg);
}

/* ---------- 分析 ---------- */
$('#analyze-btn').addEventListener('click', async () => {
  const errors = validateDraft(state.draft);
  const errBox = $('#errors');
  errBox.innerHTML = errors.map((m) => `<div class="error-item">${m}</div>`).join('');
  if (errors.length) {
    errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const btn = $('#analyze-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 正在穷举全部相位…';
  try {
    const data = await api('POST', '/api/analyses', state.draft);
    state.lastResult = { id: data.id, config: structuredClone(state.draft), result: data.result };
    renderResult($('#result'), state.lastResult, { fresh: true });
  } catch (err) {
    errBox.innerHTML = `<div class="error-item">${esc(err.message).replace(/\n/g, '<br>')}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '保存并穷举分析';
  }
});

/* ---------- 结果渲染 ---------- */
function renderResult(container, record, opts = {}) {
  const { result, config } = record;
  const r = result;
  container.innerHTML = '';

  // 不可变快照提示
  const banner = document.createElement('div');
  banner.className = 'banner';
  if (opts.fresh) {
    banner.innerHTML = `结果已保存为分析记录 <b>#${record.id}</b>。记录保存时灯串与 W/k 已固定，之后在编辑器中修改不会改变本结果，可在「历史记录」中随时回看。`;
  } else {
    banner.innerHTML = `当前查看的是 <b>#${record.id}</b> 的不可变快照（保存于 ${esc(record.created_at)}）。编辑器中的后续修改不影响本记录。`;
  }
  container.appendChild(banner);

  // 结论
  const verdict = document.createElement('div');
  verdict.className = 'verdict ' + (r.solvable ? 'good' : 'bad');
  if (r.solvable) {
    verdict.innerHTML = `
      <h3>✓ 最短可辨观测窗口 N* = ${r.n_star} 位（${(r.n_star * 0.1).toFixed(1)} 秒）</h3>
      <p>在 1～${r.W} 位范围内，<b>${r.n_star}</b> 位即可使全部 ${r.pair_count} 对灯的最小汉明距离均 &gt; 2k = ${r.threshold}；
         少于该长度至少有一对灯不满足。</p>`;
  } else {
    const names = r.confused_pairs
      .map((p) => `「${esc(p.name_a)} × ${esc(p.name_b)}」d=${p.min_dist_at_w}`).join('、');
    verdict.innerHTML = `
      <h3>✗ ${r.W} 位（${(r.W * 0.1).toFixed(1)} 秒）观测窗口内无解</h3>
      <p>仍有 <b>${r.confused_pairs.length}</b> 对灯在 W=${r.W} 位下最小汉明距离 ≤ 2k = ${r.threshold}，存在每段 ${r.k} 位误判即混淆：</p>
      <p>${names || '—'}</p>
      <p>下方给出这些灯对「距离最近的起始相位组合」与逐位差异（红色列为差异位）。</p>`;
  }
  container.appendChild(verdict);

  // 元信息
  const meta = document.createElement('div');
  meta.className = 'meta-grid';
  const items = [
    ['灯数量', `${r.light_count} 盏`],
    ['灯对数', `${r.pair_count} 对`],
    ['枚举相位组合总数', r.total_phase_pairs.toLocaleString()],
    ['窗口上限 W', `${r.W} 位`],
    ['每段误判上限 k', `${r.k} 位`],
    ['可辨阈值', `d_min &gt; ${r.threshold}`],
  ];
  meta.innerHTML = items.map(([k, v]) =>
    `<div class="meta-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  container.appendChild(meta);

  // 单灯总览
  const h1 = document.createElement('h3');
  h3.className = 'section';
  h1.textContent = `各灯波形（循环串，前 ${r.W} 位）`;
  container.appendChild(h1);
  const grid = document.createElement('div');
  grid.className = 'overview-grid';
  r.lights.forEach((l, i) => {
    const card = document.createElement('div');
    card.className = 'overview-card';
    card.innerHTML = `
      <div class="title"><span>${esc(l.name)}</span><span class="muted">${l.code.length} 位 / ${(l.code.length * 0.1).toFixed(1)}s</span></div>
      <div class="sub mono">${esc(l.code)}</div>
      <div class="wave-scroll overview-wave"></div>`;
    grid.appendChild(card);
    drawCyclicWave($('.overview-wave', card), l.code, r.W);
  });
  container.appendChild(grid);

  // 灯对
  const h2 = document.createElement('h3');
  h2.className = 'section';
  h2.textContent = '逐对穷举结果与逐位见证';
  container.appendChild(h2);

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `
    <span><span class="sw" style="background:${COLOR.on}"></span>1 亮</span>
    <span><span class="sw" style="background:${COLOR.off};border:1px solid ${COLOR.offStroke}"></span>0 灭</span>
    <span><span class="sw" style="background:${COLOR.bad};border:1px solid ${COLOR.badStroke}"></span>差异位</span>
    <span>相位为该灯串首个观测位在其循环串中的下标（0 起，每位 0.1 秒）</span>`;
  container.appendChild(legend);

  const pairs = [...r.pairs];
  if (r.solvable) {
    pairs.sort((a, b) => b.first_n - a.first_n);  // 瓶颈灯对在前
  } else {
    // 仍混淆的灯对排最前，混淆对内部按 W 位距离升序（越近越危险）
    pairs.sort((a, b) => {
      const ac = a.min_dist_at_w <= r.threshold ? 0 : 1;
      const bc = b.min_dist_at_w <= r.threshold ? 0 : 1;
      return ac - bc || a.min_dist_at_w - b.min_dist_at_w;
    });
  }

  pairs.forEach((p) => container.appendChild(buildPairCard(p, r)));
}

function buildPairCard(p, r) {
  const card = document.createElement('div');
  const confused = p.min_dist_at_w <= r.threshold;
  card.className = 'pair-card' + (confused && !r.solvable ? ' confused' : '');

  let badge;
  if (r.solvable)
    badge = `<span class="badge good">n=${p.first_n} 位起可辨</span>`;
  else if (confused)
    badge = `<span class="badge bad">W=${r.W} 位仍混淆（d_min=${p.min_dist_at_w} ≤ ${r.threshold}）</span>`;
  else
    badge = `<span class="badge neutral">n=${p.first_n} 位起已可辨</span>`;

  card.innerHTML = `
    <div class="pair-head">
      <span class="pair-title">${esc(p.name_a)} × ${esc(p.name_b)}</span>
      ${badge}
    </div>
    <div class="pair-body">
      <div class="pair-facts">
        <span>周期 ${p.period_a} × ${p.period_b}</span>
        <span>穷举相位组合 ${p.phase_pairs} 组（${p.period_a}×${p.period_b}，全部枚举未抽样）</span>
        <span>W 位最近距离 d_min=${p.min_dist_at_w}</span>
      </div>
      <div class="spark"></div>
      <div class="witness"></div>
    </div>`;

  drawSparkline($('.spark', card), p.min_dist_curve, r.threshold,
    r.solvable ? p.first_n : (confused ? null : p.first_n));

  const witBox = $('.witness', card);
  if (p.witness) {
    const w = p.witness;
    const shownAt = r.solvable ? r.n_star : r.W;
    const mismatchSet = new Set(w.mismatch_positions);
    witBox.innerHTML = `
      <div class="witness-meta">
        ${r.solvable
          ? `最短窗口 N*=${r.n_star} 位下，该对距离最近的相位组合：`
          : `W=${r.W} 位下，该对距离最近（最易混淆）的相位组合：`}
        <b>${esc(p.name_a)} 相位 p=${w.phase_a}</b>（= ${w.phase_a_time_s.toFixed(1)}s），
        <b>${esc(p.name_b)} 相位 q=${w.phase_b}</b>（= ${w.phase_b_time_s.toFixed(1)}s）；
        前 ${shownAt} 位汉明距离 <b>${w.distance}</b>。
      </div>
      <div class="wave-scroll witness-wave"></div>
      <div class="mismatch-list">差异位（1 起）：${
        w.mismatch_positions.length
          ? w.mismatch_positions.join('、')
          : '<span style="color:var(--good)">无差异</span>'}</div>
      <details><summary class="muted" style="cursor:pointer;margin-top:6px">展开该相位下的原始位串</summary>
        <div class="mono muted" style="margin-top:4px">${esc(p.name_a)}：<code>${esc(w.bits_a)}</code></div>
        <div class="mono muted">${esc(p.name_b)}：<code>${esc(w.bits_b)}</code></div>
      </details>`;
    drawWitnessWave($('.witness-wave', witBox), p.name_a, p.name_b, w.bits_a, w.bits_b, mismatchSet);
  } else {
    witBox.innerHTML = `<div class="muted" style="font-size:12.5px">该对在 W=${r.W} 位内已可辨（n=${p.first_n}），不属于混淆对。</div>`;
  }
  return card;
}

/* ---------- 历史记录 ---------- */
async function loadHistory() {
  const tbody = $('#history-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted">加载中…</td></tr>';
  try {
    const list = await api('GET', '/api/analyses');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">还没有分析记录。</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((r) => `
      <tr>
        <td>#${r.id}</td>
        <td>${esc(r.created_at)}</td>
        <td>${r.light_count}</td>
        <td>${r.W}</td>
        <td>${r.k}</td>
        <td>${r.solvable
          ? `<span class="conclusion-ok">N*=${r.n_star} 位可辨</span>`
          : `<span class="conclusion-no">${r.W} 位内无解</span>`}</td>
        <td><button class="btn" data-id="${r.id}">查看快照</button></td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><span class="error-item">${esc(err.message)}</span></td></tr>`;
  }
}

$('#history-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  btn.disabled = true;
  try {
    const record = await api('GET', `/api/analyses/${id}`);
    showHistoryDetail({ id, created_at: record.created_at, config: record.config, result: record.result });
  } finally {
    btn.disabled = false;
  }
});

function showHistoryDetail(record) {
  const panel = $('#tab-history .panel');
  let detail = $('#history-detail');
  if (!detail) {
    detail = document.createElement('div');
    detail.id = 'history-detail';
    panel.appendChild(detail);
  }
  detail.innerHTML = `
    <div style="margin:6px 0 12px">
      <button class="btn" id="history-back">← 返回历史列表</button>
    </div>
    <div class="panel" style="border:1px solid var(--line);background:#fff">
      <div class="panel-head"><h2>分析记录 #${record.id} 的完整快照</h2></div>
      <div id="history-result"></div>
    </div>`;
  $('.history-table').style.display = 'none';
  panel.querySelector('.panel-head').style.display = 'none';
  detail.style.display = 'block';
  $('#history-back').addEventListener('click', () => {
    detail.style.display = 'none';
    $('.history-table').style.display = '';
    panel.querySelector('.panel-head').style.display = '';
  });
  renderResult($('#history-result'), record, { fresh: false });
}

/* ---------- 启动 ---------- */
(async function init() {
  try {
    state.draft = await api('GET', '/api/draft');
  } catch {
    state.draft = { lights: [{ name: '灯 A', code: '11010' }, { name: '灯 B', code: '10011' }], W: 40, k: 0 };
  }
  renderEditor();
})();
