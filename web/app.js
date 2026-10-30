// hanhua 控制台 app.js — 基于 iStoreOS 首页模板自建
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#2b2f38;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:99;box-shadow:0 6px 20px rgba(0,0,0,.2)';
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function fmtBytes(b) {
  if (b >= 1073741824) return (b/1073741824).toFixed(1)+' GB';
  if (b >= 1048576) return (b/1048576).toFixed(1)+' MB';
  if (b >= 1024) return (b/1024).toFixed(1)+' KB';
  return (b||0)+' B';
}
function fmtRate(bps) {
  if (bps >= 1048576) return (bps/1048576).toFixed(1)+' MB/s';
  if (bps >= 1024) return (bps/1024).toFixed(1)+' KB/s';
  return (bps||0).toFixed(1)+' B/s';
}
function fmtUp(sec) {
  if (!sec) return '--';
  const d = Math.floor(sec/86400), h = Math.floor(sec%86400/3600), m = Math.floor(sec%3600/60), s = Math.floor(sec%60);
  return (d?d+'天':'')+h+'时'+m+'分'+s+'秒';
}
function donut(pct, color, display) {
  pct = Math.min(100, Math.max(0, pct));
  const center = display !== undefined ? display : pct.toFixed(0)+'%';
  return `<div class="donut" style="background:conic-gradient(${color} ${pct*3.6}deg, #ececec ${pct*3.6}deg)"><div class="donut-hole"><b>${center}</b></div></div>`;
}

// ================= 视图切换 =================
let monTimer = null;
function showView(v) {
  document.querySelectorAll('#nav a').forEach(x => x.classList.toggle('active', x.dataset.view === v));
  document.querySelectorAll('.view').forEach(x => x.style.display = 'none');
  const el = $('#view-' + v); if (el) el.style.display = 'block';
  const sub = {home:'本机控制台', apps:'本机服务管理', monitor:'实时状态', files:'文件浏览器', system:'架构 / 负载 / 运行时长', about:'关于 hanhua', logout:'退出'}[v] || '';
  $('#view-sub').textContent = sub;
  if (v === 'monitor') { startMonitor(); }
  else { stopMonitor(); }
  if (v === 'apps') loadApps();
  else if (v === 'files') renderFiles('/');
  else if (v === 'system') renderSystem();
  else if (v === 'home') loadHome();
  else if (v === 'about') renderAbout();
}

// 菜单点击 + 搜索过滤
document.querySelectorAll('#nav a').forEach(a => a.onclick = (e) => { e.preventDefault(); showView(a.dataset.view); });
$('#nav-search').addEventListener('input', function() {
  const q = this.value.trim().toLowerCase();
  document.querySelectorAll('#nav a').forEach(a => {
    a.style.display = !q || a.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ================= 首页仪表盘 =================
let homeData = [];
async function loadHome() {
  $('#foot-status').textContent = 'v1.1 · 刷新中…';
  try {
    const r = await fetch('/api/status'); const s = await r.json();
    $('#uptime').textContent = fmtUp(s.uptime_sec);
    const ips = s.ips || [];
    $('#ip-chips').innerHTML = ips.map(ip => `<button class="chip">${esc(ip)}</button>`).join('') || '<span class="muted">无 IPv4</span>';
    $('#ip-mask').textContent = ips[0] || '--';
    // DNS = 网关（首段.1）
    const gw = ips[0] ? ips[0].split('.').slice(0,3).join('.')+'.1' : '--';
    $('#dns').textContent = gw;
    // 网络接口
    const ifaces = ips.map(ip => {
      const isLan = ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
      const isTs = ip.startsWith('100.');
      const name = isTs ? 'tailscale0' : (isLan ? 'wlan0' : 'eth0');
      return `<div class="iface"><div class="plug"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9h4v11H5z"/><path d="M11 5h4v15h-4z"/></svg></div><div class="meta"><b>${esc(name)}</b><small>${esc(ip)} · 已连接</small></div><span class="tag-ok">已连接</span></div>`;
    }).join('') || '<div class="muted">无接口</div>';
    $('#iface-list').innerHTML = ifaces;
    $('#net-state').textContent = ips.length ? '网络连接正常' : '网络未连接';
    $('#foot-status').textContent = 'v1.1 · 系统运行正常';
    // 应用计数
    try {
      const ar = await fetch('/api/apps'); const ad = await ar.json();
      const n = (ad.apps||[]).length;
      $('#app-count-badge').textContent = n+' 服务';
      $('#card-app-count').textContent = n+' 服务';
    } catch(e){}
  } catch (e) {
    $('#foot-status').textContent = 'v1.1 · 获取状态失败';
    $('#net-state').textContent = '连接失败';
  }
}

// 实时流量（首页 + 监控共用）
let netData = [], lastNet = null;
async function pollNet() {
  try {
    const r = await fetch('/api/status'); const s = await r.json();
    const now = Date.now();
    let rxRate = 0, txRate = 0;
    if (lastNet) {
      const dt = (now - lastNet.t) / 1000;
      if (dt > 0) { rxRate = Math.max(0, s.net_rx - lastNet.rx) / dt; txRate = Math.max(0, s.net_tx - lastNet.tx) / dt; }
    }
    lastNet = { rx: s.net_rx, tx: s.net_tx, t: now };
    netData.push({ rx: rxRate, tx: txRate });
    if (netData.length > 40) netData.shift();
    // 首页
    const rxEl = $('#net-rx'); if (rxEl) rxEl.textContent = fmtRate(rxRate);
    const txEl = $('#net-tx'); if (txEl) txEl.textContent = fmtRate(txRate);
    drawChart('#net-chart', netData);
    // 监控
    const mrx = $('#mon-rx'); if (mrx) { mrx.textContent = fmtRate(rxRate); $('#mon-tx').textContent = fmtRate(txRate); }
    drawChart('#mon-chart', netData);
    renderMonitorCards(s);
  } catch (e) {}
}
function startMonitor() { stopMonitor(); monTimer = setInterval(pollNet, 2000); pollNet(); }
function stopMonitor() { if (monTimer) { clearInterval(monTimer); monTimer = null; } }

// SVG 面积图（模板风格）
function drawChart(sel, data) {
  const svg = $(sel); if (!svg) return;
  const W = 800, H = 330;
  const max = Math.max(10, ...data.map(d => Math.max(d.rx, d.tx)));
  const n = data.length;
  const pts = (key) => data.map((d, i) => {
    const x = W - (n-1-i) * (W / Math.max(n, 1));
    const y = H - 20 - (d[key]/max) * (H - 60);
    return [Math.round(x), Math.round(y)];
  });
  const areaPath = (key) => {
    const p = pts(key); if (!p.length) return '';
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 1; i < p.length; i++) { const [x,y] = p[i]; const [px,py] = p[i-1]; d += ` C${Math.round((px+x)/2)},${py} ${Math.round((px+x)/2)},${y} ${x},${y}`; }
    return `${d} L${p[p.length-1][0]},${H-20} L${p[0][0]},${H-20} Z`;
  };
  const linePath = (key) => {
    const p = pts(key); if (!p.length) return '';
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 1; i < p.length; i++) { const [x,y] = p[i]; const [px,py] = p[i-1]; d += ` C${Math.round((px+x)/2)},${py} ${Math.round((px+x)/2)},${y} ${x},${y}`; }
    return d;
  };
  svg.innerHTML = `
    <defs>
      <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22b6ff" stop-opacity=".55"/><stop offset="1" stop-color="#22b6ff" stop-opacity="0"/></linearGradient>
      <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b4bf0" stop-opacity=".5"/><stop offset="1" stop-color="#5b4bf0" stop-opacity="0"/></linearGradient>
    </defs>
    <g stroke="#eef0f5" stroke-width="1">
      <line x1="0" y1="60" x2="800" y2="60"/><line x1="0" y1="150" x2="800" y2="150"/><line x1="0" y1="240" x2="800" y2="240"/>
    </g>
    <path d="${areaPath('rx')}" fill="url(#gRx)"/>
    <path d="${linePath('rx')}" fill="none" stroke="#22b6ff" stroke-width="2.4"/>
    <path d="${areaPath('tx')}" fill="url(#gTx)"/>
    <path d="${linePath('tx')}" fill="none" stroke="#5b4bf0" stroke-width="2.4"/>`;
}

// ================= 应用商店 =================
let ALL = [];
async function loadApps() {
  try {
    const r = await fetch('/api/apps'); const d = await r.json();
    ALL = d.apps || [];
  } catch (e) { toast('加载应用失败'); }
  renderApps();
}
function renderApps() {
  const el = $('#app-cards'); if (!el) return;
  if (!ALL.length) { el.innerHTML = '<div class="empty">没有应用</div>'; return; }
  el.innerHTML = ALL.map(a => {
    const on = a.status === 'active' || a.status === 'running';
    const tags = (a.tags||[]).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const btn = a.unit
      ? (on
          ? `<button class="act" data-act="restart" data-unit="${esc(a.unit)}">重启</button><button class="act" data-act="stop" data-unit="${esc(a.unit)}">停止</button>`
          : `<button class="act primary" data-act="start" data-unit="${esc(a.unit)}">启动</button>`)
      : '';
    return `<div class="app-card">
      <div class="head">
        <div class="icon" style="background:#f0ebff">${esc(a.icon)}</div>
        <div>
          <div class="title">${esc(a.name)} <span class="ver">v${esc(a.version)}</span></div>
          <div class="meta">作者:${esc(a.author)}${a.port?` · 端口:${a.port}${a.port_ok?' <span style="color:#3bc47d">●</span>':' <span style="color:#ef5a24">○</span>'}`:''}</div>
        </div>
      </div>
      <div class="desc">${esc(a.desc)}</div>
      <div class="foot">
        <div class="tags">${tags}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge-s ${on?'ok':'off'}">${on?'● 运行中':'○ 已停止'}</span>
          <div class="actions">${btn}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => doAction(b));
}
async function doAction(btn) {
  const unit = btn.dataset.unit, act = btn.dataset.act;
  btn.disabled = true; btn.textContent = '执行中…';
  try {
    const r = await fetch('/api/action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({unit, action: act}) });
    const d = await r.json();
    toast(d.ok ? `已${act==='start'?'启动':act==='stop'?'停止':'重启'} ${unit}` : `操作失败: ${d.err||d.output||''}`);
  } catch (e) { toast('请求失败'); }
  btn.disabled = false; btn.textContent = act === 'start' ? '启动' : (act === 'stop' ? '停止' : '重启');
  await loadApps();
}

// ================= 监控视图 =================
function renderMonitorCards(s) {
  const dEl = $('#sys-donuts'); if (!dEl) return;
  const tempDisp = s.temp_c > 0 ? s.temp_c.toFixed(0)+'℃' : '--';
  dEl.innerHTML = `
    <div class="donut-item">${donut(s.cpu_pct, '#5b6ef5')}<span>CPU</span></div>
    <div class="donut-item">${donut(Math.min(s.temp_c,100), '#22c55e', tempDisp)}<span>温度</span></div>
    <div class="donut-item">${donut(s.mem_pct, '#8b5cf6')}<span>内存</span></div>`;
  const dl = $('#disk-list'); if (dl) dl.innerHTML = (s.drives||[]).map(d => `
    <div class="disk-row">
      <div class="disk-name"><code>${esc(d.device)}</code><small>${esc(d.mount)}</small></div>
      <div class="bar"><div class="bar-fill ${d.pct>80?'red':''}" style="width:${Math.min(d.pct,100)}%"></div></div>
      <span class="muted">${d.pct}% · ${fmtBytes(d.used)} / ${fmtBytes(d.size)}</span>
    </div>`).join('') || '<div class="muted">无磁盘</div>';
}

// ================= 文件浏览器 =================
async function renderFiles(path) {
  const el = $('#fs-body'); if (!el) return;
  el.innerHTML = '<div class="muted">加载中…</div>';
  let drives = [];
  try { drives = (await (await fetch('/api/drives')).json()).drives || []; } catch (e) {}
  let data = { path:'/', parent:'/', items:[] };
  let fsErr = null;
  try {
    data = await (await fetch('/api/fs?path=' + encodeURIComponent(path))).json();
    if (data.error) fsErr = data.error;
  } catch (e) { fsErr = '加载失败：' + (e.message || e); }
  if (fsErr) {
    el.innerHTML = `<div class="fs-wrap"><div class="fs-main"><div class="empty" style="padding:40px">⚠️ ${esc(fsErr)} <button class="fs-btn" style="margin-left:10px" onclick="renderFiles('/')">返回根目录</button></div></div></div>`;
    return;
  }
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
  const up = $('#fs-up'); if (up) up.onclick = () => renderFiles(data.parent || '/');
}

// ================= 系统 / 关于 =================
async function renderSystem() {
  const el = $('#sys-info'); if (!el) return;
  el.innerHTML = '<div class="muted">加载中…</div>';
  try {
    const r = await fetch('/api/system'); const s = await r.json();
    el.innerHTML = `
      <div class="kv"><span class="k">内存</span><span class="v">${s.mem_avail_mb} / ${s.mem_total_mb} MB (${s.mem_pct.toFixed(0)}%)</span></div>
      <div class="kv"><span class="k">负载 1/5/15</span><span class="v">${s.load1.toFixed(1)} / ${s.load5.toFixed(1)} / ${s.load15.toFixed(1)}</span></div>
      <div class="kv"><span class="k">运行时长</span><span class="v">${fmtUp(s.uptime_sec)}</span></div>
      <div class="kv"><span class="k">架构</span><span class="v">${esc(s.arch)}</span></div>`;
  } catch (e) { el.innerHTML = '<div class="muted">获取失败</div>'; }
}
function renderAbout() {
  const el = $('#view-about'); if (!el) return;
}

// 初始化
loadHome();
