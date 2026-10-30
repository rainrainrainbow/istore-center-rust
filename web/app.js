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

// 视图切换（应用商店 / 关于）
document.querySelectorAll('.menu a').forEach(a => a.onclick = () => {
  document.querySelectorAll('.menu a').forEach(x => x.classList.remove('active'));
  a.classList.add('active');
  const v = a.dataset.view;
  if (v === 'apps') { $('#view-title').textContent = '应用商店'; $('#view-sub').textContent = '本机服务管理'; loadApps(); }
  else { $('#view-title').textContent = '关于'; $('#view-sub').textContent = 'iStore 软件中心'; renderAbout(); }
});

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
