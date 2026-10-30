// istore-center app.js — iStore 风格软件中心前端
let ALL = [];
let CATS = [];
let curTab = 'all';
let SYS = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

function fmtUp(sec) {
  if (!sec) return '-';
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return (d ? d + '天' : '') + (h ? h + '时' : '') + m + '分';
}

async function loadSystem() {
  try {
    const r = await fetch('/api/system'); SYS = await r.json();
  } catch (e) { SYS = null; }
  renderSystem();
}

function renderSystem() {
  const el = $('#content');
  const s = SYS;
  let html = '<div class="sysrow">';
  if (s) {
    html += `<div class="syscard"><div class="k">内存</div><div class="v">${s.mem_avail_mb} <small>/ ${s.mem_total_mb} MB</small></div></div>`;
    html += `<div class="syscard"><div class="k">内存占用</div><div class="v">${s.mem_pct.toFixed(0)}<small>%</small></div></div>`;
    html += `<div class="syscard"><div class="k">负载 1/5/15</div><div class="v">${s.load1.toFixed(1)} <small>${s.load5.toFixed(1)} / ${s.load15.toFixed(1)}</small></div></div>`;
    html += `<div class="syscard"><div class="k">运行时长</div><div class="v">${fmtUp(s.uptime_sec)}</div></div>`;
    html += `<div class="syscard"><div class="k">架构</div><div class="v">${esc(s.arch)}</div></div>`;
  }
  html += '</div>';
  return html;
}

async function loadApps() {
  try {
    const r = await fetch('/api/apps'); const d = await r.json();
    ALL = d.apps || [];
    CATS = [...new Set(ALL.map(a => a.category))];
    const tabs = $('#tabs');
    let th = `<span class="tab ${curTab==='all'?'active':''}" data-tab="all">全部 ${ALL.length}</span>`;
    th += `<span class="tab ${curTab==='on'?'active':''}" data-tab="on">已安装</span>`;
    th += `<span class="tab ${curTab==='off'?'active':''}" data-tab="off">未安装</span>`;
    CATS.forEach(c => { th += `<span class="tab ${curTab===c?'active':''}" data-tab="${esc(c)}">${esc(c)}</span>`; });
    tabs.innerHTML = th;
    tabs.querySelectorAll('.tab').forEach(t => t.onclick = () => { curTab = t.dataset.tab; render(); });
  } catch (e) { toast('加载应用失败'); }
  render();
}

function visible() {
  if (curTab === 'all') return ALL;
  if (curTab === 'on') return ALL.filter(a => a.status === 'active' || a.status === 'running');
  if (curTab === 'off') return ALL.filter(a => a.status !== 'active' && a.status !== 'running');
  return ALL.filter(a => a.category === curTab);
}

function statusBadge(a) {
  const on = a.status === 'active' || a.status === 'running';
  return `<span class="badge ${on?'ok':'off'}">${on?'● 运行中':'○ 已停止'}</span>`;
}

function render() {
  const el = $('#content');
  const sys = renderSystem();
  const list = visible();
  if (!list.length) { el.innerHTML = sys + '<div class="empty">没有匹配的应用</div>'; return; }
  let html = list.map(a => {
    const on = a.status === 'active' || a.status === 'running';
    const tags = (a.tags||[]).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const btn = a.unit
      ? (on
          ? `<button class="btn btn-soft" data-act="restart" data-unit="${esc(a.unit)}">重启</button><button class="btn btn-soft" data-act="stop" data-unit="${esc(a.unit)}">停止</button>`
          : `<button class="btn btn-primary" data-act="start" data-unit="${esc(a.unit)}">启动</button>`)
      : `<span class="hint" style="font-size:12px;color:#888">端口探测</span>`;
    return `<div class="card">
      <div class="head">
        <div class="icon">${esc(a.icon)}</div>
        <div>
          <div class="title">${esc(a.name)} <span class="ver">v${esc(a.version)}</span> ${statusBadge(a)}</div>
          <div class="meta">作者:${esc(a.author)}${a.port?` · 端口:${a.port}${a.port_ok?' <span style="color:#27ae60">●</span>':' <span style="color:#e74c3c">○</span>'}`:''}</div>
        </div>
      </div>
      <div class="desc">${esc(a.desc)}</div>
      <div class="foot"><div class="tags">${tags}</div><div class="actions">${btn}</div></div>
    </div>`;
  }).join('');
  el.innerHTML = sys + `<div class="grid">${html}</div>`;
  el.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => doAction(b));
}

async function doAction(btn) {
  const unit = btn.dataset.unit, act = btn.dataset.act;
  btn.disabled = true; btn.textContent = '执行中…';
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({unit, action: act}) });
    const d = await r.json();
    toast(d.ok ? `已${act==='start'?'启动':act==='stop'?'停止':'重启'} ${unit}` : (`操作失败: ${d.err||d.output||''}`));
  } catch (e) { toast('请求失败'); }
  btn.disabled = false; btn.textContent = act === 'start' ? '启动' : (act === 'stop' ? '停止' : '重启');
  await loadApps();
}

// 视图切换（应用商店 / 监控 / 文件 / 关于）
let monTimer = null, monData = [];
document.querySelectorAll('.menu a').forEach(a => a.onclick = () => {
  document.querySelectorAll('.menu a').forEach(x => x.classList.remove('active'));
  a.classList.add('active');
  const v = a.dataset.view;
  if (v === 'apps') { $('#view-title').textContent = '应用商店'; $('#view-sub').textContent = '本机服务管理'; loadApps(); }
  else if (v === 'monitor') { $('#view-title').textContent = '监控'; $('#view-sub').textContent = '实时状态'; renderMonitor(); startMonitor(); }
  else if (v === 'files') { $('#view-title').textContent = '文件'; $('#view-sub').textContent = '文件浏览器'; stopMonitor(); renderFiles('/'); }
  else { $('#view-title').textContent = '关于'; $('#view-sub').textContent = 'iStore 软件中心'; stopMonitor(); renderAbout(); }
});

// ---------- 监控面板 ----------
function fmtBytes(b) {
  if (b >= 1073741824) return (b/1073741824).toFixed(1)+' GB';
  if (b >= 1048576) return (b/1048576).toFixed(1)+' MB';
  if (b >= 1024) return (b/1024).toFixed(1)+' KB';
  return b+' B';
}
function fmtRate(bps) {
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' MB/s';
  if (bps >= 1024) return (bps/1024).toFixed(1)+' KB/s';
  return bps.toFixed(1)+' B/s';
}
function donut(pct, color) {
  return `<div class="donut" style="background:conic-gradient(${color} ${pct*3.6}deg, #ececec ${pct*3.6}deg)"><div class="donut-hole"><b>${pct.toFixed(0)}%</b><span>${pct.toFixed(0)}</span></div></div>`;
}

let lastNet = null;
async function pollMonitor() {
  try {
    const r = await fetch('/api/status'); const s = await r.json();
    // 网络速率 = 差分
    let rxRate = 0, txRate = 0;
    if (lastNet) {
      rxRate = Math.max(0, s.net_rx - lastNet.rx) / 2; // 每 2s 轮询
      txRate = Math.max(0, s.net_tx - lastNet.tx) / 2;
    }
    lastNet = { rx: s.net_rx, tx: s.net_tx };
    monData.push({ rx: rxRate, tx: txRate });
    if (monData.length > 40) monData.shift();
    renderMonitorCards(s, rxRate, txRate);
    drawNetChart();
  } catch (e) {}
}
function startMonitor() { stopMonitor(); monTimer = setInterval(pollMonitor, 2000); pollMonitor(); }
function stopMonitor() { if (monTimer) { clearInterval(monTimer); monTimer = null; } }

function renderMonitor() {
  $('#content').innerHTML = `
    <div class="mon-grid">
      <div class="mon-card" style="grid-column:1 / -1">
        <div class="mon-head"><span>网络流量</span><span id="net-vals" class="muted">下载 0 · 上传 0</span></div>
        <canvas id="net-chart" width="900" height="220"></canvas>
      </div>
      <div class="mon-card">
        <div class="mon-head">网络连接和IP地址</div>
        <div id="net-ip" class="mon-body"></div>
      </div>
      <div class="mon-card">
        <div class="mon-head">系统信息</div>
        <div class="donuts" id="sys-donuts"></div>
      </div>
      <div class="mon-card" style="grid-column:1 / -1">
        <div class="mon-head">磁盘信息</div>
        <div id="disk-list" class="mon-body"></div>
      </div>
      <div class="mon-card">
        <div class="mon-head">系统时间</div><div class="mon-big" id="sys-time">--</div>
      </div>
      <div class="mon-card">
        <div class="mon-head">已运行</div><div class="mon-big" id="sys-up">--</div>
      </div>
    </div>`;
}
function renderMonitorCards(s, rx, tx) {
  $('#net-vals').textContent = `下载 ${fmtRate(rx)} · 上传 ${fmtRate(tx)}`;
  $('#net-ip').innerHTML = (s.ips||[]).map(ip => `<div class="ip-row">🌐 <code>${esc(ip)}</code></div>`).join('') || '<div class="muted">无 IPv4</div>';
  $('#sys-donuts').innerHTML = `
    <div class="donut-item">${donut(s.cpu_pct, '#3b82f6')}<span>CPU</span></div>
    <div class="donut-item">${donut(s.temp_c, '#22c55e')}<span>温度 ℃</span></div>
    <div class="donut-item">${donut(s.mem_pct, '#8b5cf6')}<span>内存</span></div>`;
  $('#disk-list').innerHTML = (s.drives||[]).map(d => `
    <div class="disk-row">
      <div class="disk-name"><code>${esc(d.device)}</code><span class="muted">${esc(d.mount)}</span></div>
      <div class="bar"><div class="bar-fill ${d.pct>80?'red':''}" style="width:${Math.min(d.pct,100)}%"></div></div>
      <span class="muted">${d.pct}% · ${fmtBytes(d.used)} / ${fmtBytes(d.size)}</span>
    </div>`).join('') || '<div class="muted">无磁盘</div>';
  const now = new Date();
  const p = n => String(n).padStart(2,'0');
  $('#sys-time').textContent = `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  $('#sys-up').textContent = fmtUp(s.uptime_sec);
}
function drawNetChart() {
  const c = document.getElementById('net-chart'); if (!c) return;
  const ctx = c.getContext('2d'); const W = c.width, H = c.height; ctx.clearRect(0,0,W,H);
  const max = Math.max(10, ...monData.map(d => Math.max(d.rx, d.tx)));
  const n = monData.length, step = W / Math.max(n, 1);
  const line = (key, color) => {
    ctx.beginPath();
    monData.forEach((d, i) => {
      const x = W - (n-1-i)*step, y = H - 10 - (d[key]/max)*(H-30);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    // 渐变面积
    ctx.lineTo(W, H-10); ctx.lineTo(W-(n)*step, H-10); ctx.closePath();
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, color+'55'); g.addColorStop(1, color+'00');
    ctx.fillStyle = g; ctx.fill();
  };
  line('rx', '#3b82f6'); line('tx', '#22c55e');
}

// ---------- 文件浏览器 ----------
async function renderFiles(path) {
  stopMonitor();
  const el = $('#content');
  el.innerHTML = '<div class="muted">加载中…</div>';
  let drives = [];
  try { drives = (await (await fetch('/api/drives')).json()).drives || []; } catch (e) {}
  let data = { path: '/', parent: '/', items: [] };
  try { data = await (await fetch('/api/fs?path=' + encodeURIComponent(path))).json(); } catch (e) {}
  const cur = data.path || path;
  const crumbs = cur.split('/').filter(Boolean);
  let crumbHtml = '<span class="crumb" data-p="/">根目录</span>';
  let acc = '';
  crumbs.forEach((c, i) => { acc += '/' + c; crumbHtml += ' <span class="crumb-sep">›</span> <span class="crumb" data-p="'+esc(acc)+'">'+esc(c)+'</span>'; });
  const folders = data.items.filter(i => i.is_dir), files = data.items.filter(i => !i.is_dir);
  let itemsHtml = '';
  if (cur !== '/') itemsHtml += `<div class="fs-item" data-p="${esc(data.parent)}"><div class="fs-icon">📂</div><div class="fs-label">..</div></div>`;
  itemsHtml += data.items.map(i => `
    <div class="fs-item" ${i.is_dir?'data-p="'+esc(cur.replace(/\/$/,'')+'/'+i.name)+'"':''}>
      <div class="fs-icon">${i.is_dir?'📁':'📄'}</div>
      <div class="fs-label">${esc(i.name)}</div>
      ${i.is_dir?'':'<div class="fs-size">'+fmtBytes(i.size)+'</div>'}
    </div>`).join('');
  el.innerHTML = `
    <div class="fs-wrap">
      <aside class="fs-side">
        <div class="fs-side-title">本地硬盘</div>
        ${drives.map(d => `<div class="fs-drive" data-p="${esc(d.mount)}">💾 ${esc(d.device)}<small>${esc(d.mount)} · ${d.pct}%</small></div>`).join('')}
        <div class="fs-side-title">快捷</div>
        <div class="fs-drive" data-p="/root">📁 /root</div>
        <div class="fs-drive" data-p="/">📁 /</div>
      </aside>
      <div class="fs-main">
        <div class="fs-toolbar">
          <button class="fs-btn" id="fs-up">⬅ 上级</button>
          <div class="fs-crumbs">${crumbHtml}</div>
        </div>
        <div class="fs-grid">${itemsHtml}</div>
        <div class="fs-status">${folders.length} 个文件夹, ${files.length} 个文件</div>
      </div>
    </div>`;
  el.querySelectorAll('[data-p]').forEach(n => n.onclick = () => renderFiles(n.dataset.p));
  const up = document.getElementById('fs-up'); if (up) up.onclick = () => renderFiles(data.parent || '/');
}

function renderAbout() {
  const el = $('#content');
  el.innerHTML = `${renderSystem()}<div class="card" style="max-width:520px">
    <div class="head"><div class="icon">🏪</div><div>
      <div class="title">应用商店 <span class="ver">v0.1.0</span></div>
      <div class="meta">复刻 iStoreOS 软件中心外观 · Rust 版</div></div></div>
    <div class="desc">管理本机 systemd 用户服务：启动/停止/重启、端口探测、内存/负载/运行时长。单二进制 tiny_http + 内嵌前端，GitHub Actions 交叉编译 aarch64-musl，RSS 低。</div>
    <div class="foot"><div class="tags"><span class="tag">rust</span><span class="tag">systemd</span><span class="tag">web</span></div></div>
  </div>`;
}

loadSystem();
loadApps();
