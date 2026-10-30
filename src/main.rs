// istore-center-rust — 复刻 iStoreOS 软件中心外观的 Rust 版，管理本机 systemd 服务。
// tiny_http 单二进制，内嵌前端；后端直接操作 systemd --user 单元 + 端口探测。
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Read;
use std::net::{TcpStream, SocketAddr, ToSocketAddrs};
use std::process::Command;
use std::time::Duration;
use tiny_http::{Header, Response, Server};

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const STYLE_CSS: &str = include_str!("../web/style.css");

// 本机应用目录：映射到真实 systemd 单元 + 端口。
#[derive(Clone, Serialize)]
struct App {
    id: &'static str,
    name: &'static str,
    icon: &'static str,
    desc: &'static str,
    unit: &'static str,
    port: u16,
    category: &'static str,
    tags: Vec<&'static str>,
    author: &'static str,
    version: &'static str,
}

fn catalog() -> Vec<App> {
    vec![
        App { id:"shuati-webui", name:"刷题网页", icon:"📝", desc:"国考行测/申论/计算机岗刷题", unit:"shuati-webui.service", port:8085, category:"学习", tags:vec!["学习","web"], author:"rainrainrainbow", version:"0.1.0" },
        App { id:"xiaoyu-review", name:"小雨审核", icon:"✅", desc:"公众号写作审核与排版", unit:"xiaoyu-review.service", port:8080, category:"编辑", tags:vec!["编辑","web"], author:"rainrainrainbow", version:"0.1.0" },
        App { id:"harness-webui", name:"刷题复刻", icon:"🧪", desc:"DeepSeek Harness Web UI 复刻", unit:"harness-webui.service", port:8989, category:"学习", tags:vec!["学习","web"], author:"rainrainrainbow", version:"0.1.0" },
        App { id:"hermes-dashboard", name:"监控看板", icon:"📊", desc:"Hermes 只读监控面板", unit:"hermes-dashboard.service", port:8081, category:"监控", tags:vec!["监控","web"], author:"rainrainrainbow", version:"0.1.0" },
        App { id:"apk-download", name:"APK 下载", icon:"📦", desc:"古诗 App APK 分发", unit:"apk-download.service", port:8980, category:"工具", tags:vec!["工具","下载"], author:"rainrainrainbow", version:"0.1.0" },
        App { id:"hermes-gateway", name:"Hermes 网关", icon:"🤖", desc:"Hermes Agent 网关服务", unit:"hermes-gateway.service", port:0, category:"工具", tags:vec!["工具","agent"], author:"Nous Research", version:"0.1.0" },
        App { id:"onebot-mock", name:"QQ Bot 测试", icon:"💬", desc:"OneBot 协议 mock 后端", unit:"onebot-mock.service", port:3000, category:"开发", tags:vec!["开发","bot"], author:"rainrainrainbow", version:"0.1.0" },
        App { id:"web-terminal", name:"Web 终端", icon:"🖥️", desc:"浏览器终端（无单元，端口探测）", unit:"", port:8914, category:"工具", tags:vec!["工具","终端"], author:"rainrainrainbow", version:"0.1.0" },
    ]
}

// 运行 shell 命令并返回 (exit_ok, stdout)。仅限内部固定字符串（df/ip），不拼接外部输入。
fn run_cmd(cmd: &str) -> (bool, String) {
    match Command::new("/bin/sh").arg("-c").arg(cmd).output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
            (o.status.success(), if out.is_empty() { err } else { out })
        }
        Err(e) => (false, e.to_string()),
    }
}

// 参数化执行 systemctl（无 shell），杜绝注入。
fn run_systemctl(act: &str, unit: &str) -> (bool, String) {
    match Command::new("systemctl").arg("--user").arg(act).arg(unit).output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
            (o.status.success(), if out.is_empty() { err } else { out })
        }
        Err(e) => (false, e.to_string()),
    }
}

// unit 必须在应用目录中（白名单），且形如 xxx.service。
fn unit_whitelisted(unit: &str) -> bool {
    if !unit.ends_with(".service") || unit.contains(';') || unit.contains('&') || unit.contains('|') || unit.contains('`') { return false; }
    catalog().iter().any(|a| a.unit == unit)
}

fn unit_status(unit: &str) -> String {
    if unit.is_empty() { return String::new(); }
    run_cmd(&format!("systemctl --user is-active {}", unit)).1
}

fn unit_enabled(unit: &str) -> bool {
    if unit.is_empty() { return false; }
    run_cmd(&format!("systemctl --user is-enabled {}", unit)).0
}

fn port_open(port: u16) -> bool {
    if port == 0 { return false; }
    let addr: Option<SocketAddr> = ("127.0.0.1".to_string(), port)
        .to_socket_addrs().ok().and_then(|mut it| it.next());
    match addr {
        Some(a) => TcpStream::connect_timeout(&a, Duration::from_millis(400)).is_ok(),
        None => false,
    }
}

fn mem_mb() -> (u64, u64) {
    let txt = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let mut total = 0u64; let mut avail = 0u64;
    for line in txt.lines() {
        let mut it = line.split_whitespace();
        let k = it.next().unwrap_or("");
        let v: u64 = it.next().unwrap_or("0").parse().unwrap_or(0);
        if k == "MemTotal:" { total = v / 1024; }
        else if k == "MemAvailable:" { avail = v / 1024; }
    }
    (total, avail)
}

fn loadavg() -> (f64, f64, f64) {
    let txt = std::fs::read_to_string("/proc/loadavg").unwrap_or_default();
    let parts: Vec<&str> = txt.split_whitespace().collect();
    let g = |i: usize| parts.get(i).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    (g(0), g(1), g(2))
}

fn uptime_sec() -> u64 {
    std::fs::read_to_string("/proc/uptime").ok()
        .and_then(|s| s.split_whitespace().next().and_then(|x| x.parse::<f64>().ok()))
        .unwrap_or(0.0) as u64
}

fn hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname").unwrap_or_default().trim().to_string()
}

fn kernel() -> String {
    std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default().trim().to_string()
}

fn proc_count() -> u64 {
    // /proc 下纯数字目录即进程
    std::fs::read_dir("/proc").map(|rd| rd.flatten().filter(|e| {
        e.file_name().to_string_lossy().chars().all(|c| c.is_ascii_digit())
    }).count() as u64).unwrap_or(0)
}

// ---------- 监控 / 文件系统 ----------
fn cpu_pct() -> f64 {
    // 读 /proc/stat 两次（间隔 200ms）算 CPU 占用
    let sample = || -> (u64, u64) {
        let txt = std::fs::read_to_string("/proc/stat").unwrap_or_default();
        let line = txt.lines().find(|l| l.starts_with("cpu ")).unwrap_or("");
        let nums: Vec<u64> = line.split_whitespace().skip(1).filter_map(|s| s.parse().ok()).collect();
        if nums.len() < 4 { return (0, 0); }
        let idle = nums[3] + nums.get(4).copied().unwrap_or(0);
        (nums.iter().sum::<u64>(), idle)
    };
    let (t1, i1) = sample();
    std::thread::sleep(std::time::Duration::from_millis(200));
    let (t2, i2) = sample();
    let dt = t2.saturating_sub(t1);
    let di = i2.saturating_sub(i1);
    if dt == 0 { return 0.0; }
    (100.0 * (dt - di) as f64 / dt as f64).max(0.0)
}

fn temp_c() -> f64 {
    // /sys/class/thermal/thermal_zone0/temp 单位毫摄氏度
    let paths = ["/sys/class/thermal/thermal_zone0/temp", "/sys/class/thermal/thermal_zone1/temp"];
    for p in paths {
        if let Ok(s) = std::fs::read_to_string(p) {
            if let Ok(v) = s.trim().parse::<f64>() { return v / 1000.0; }
        }
    }
    0.0
}

fn net_rx_tx() -> (u64, u64) {
    // /proc/net/dev: 网卡累计 rx/tx 字节（前端按轮询差分算速率）
    let txt = std::fs::read_to_string("/proc/net/dev").unwrap_or_default();
    let mut rx = 0u64; let mut tx = 0u64;
    for line in txt.lines().skip(2) {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() < 2 { continue; }
        let iface = parts[0].trim();
        if iface == "lo" { continue; }
        let vals: Vec<u64> = parts[1].split_whitespace().filter_map(|s| s.parse().ok()).collect();
        if vals.len() >= 9 { rx += vals[0]; tx += vals[8]; }
    }
    (rx, tx)
}

fn lan_ips() -> Vec<String> {
    let (_, out) = run_cmd("ip -4 -o addr show 2>/dev/null | awk '{print $2\"=\"$4}' | grep -v 'lo\\|127.0.0.1'");
    out.lines().map(|s| s.split('=').nth(1).unwrap_or("").split('/').next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty()).collect()
}

fn drives() -> Vec<serde_json::Value> {
    // df -P 解析块设备挂载
    let (_, out) = run_cmd("df -P -B1 2>/dev/null | grep -vE 'tmpfs|devtmpfs|overlay|proc|sysfs|cgroup'");
    let mut v = Vec::new();
    for line in out.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 6 { continue; }
        let dev = f[0];
        if dev == "Filesystem" || dev.contains("shm") { continue; }
        v.push(json!({
            "device": dev, "size": f[1].parse::<u64>().unwrap_or(0),
            "used": f[2].parse::<u64>().unwrap_or(0),
            "avail": f[3].parse::<u64>().unwrap_or(0),
            "pct": f[4].trim_end_matches('%').parse::<u64>().unwrap_or(0),
            "mount": f[5],
        }));
    }
    v
}

fn urldecode(s: &str) -> String {
    // 简易百分号解码（支持 %XX）
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'+' { out.push(b' '); i += 1; continue; }
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Ok(h), Ok(l)) = (hex(b[i+1]), hex(b[i+2])) {
                out.push((h << 4) | l); i += 3; continue;
            }
        }
        out.push(b[i]); i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn hex(c: u8) -> Result<u8, ()> {
    match c { b'0'..=b'9' => Ok(c - b'0'), b'a'..=b'f' => Ok(c - b'a' + 10), b'A'..=b'F' => Ok(c - b'A' + 10), _ => Err(()) }
}

// 路径防护：canonicalize + 禁伪文件系统 + 允许根，返回安全路径。
fn safe_fs_path(path: &str) -> Option<String> {
    let canon = std::fs::canonicalize(path).ok()?;
    let s = canon.to_string_lossy().into_owned();
    // 禁敏感/伪文件系统
    for bad in ["/proc", "/sys", "/dev", "/run", "/boot/efi"] {
        if s == bad || s.starts_with(&format!("{}/", bad)) { return None; }
    }
    // 允许根
    let roots = ["/root", "/mnt", "/home", "/boot", "/var", "/opt", "/usr", "/tmp", "/etc"];
    if s == "/" { return Some(s); }
    if roots.iter().any(|r| s == *r || s.starts_with(&format!("{}/", r))) { return Some(s); }
    None
}

fn fs_list(path: &str, show_hidden: bool) -> Vec<serde_json::Value> {
    let mut v = Vec::new();
    if let Ok(rd) = std::fs::read_dir(path) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !show_hidden && name.starts_with('.') { continue; } // 默认隐藏
            let is_dir = e.path().is_dir();
            let size = if is_dir { 0 } else { e.metadata().map(|m| m.len()).unwrap_or(0) };
            let mtime = e.metadata().ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as u64).unwrap_or(0);
            v.push(json!({"name": name, "is_dir": is_dir, "size": size, "mtime": mtime}));
        }
    }
    v.sort_by(|a, b| {
        let ad = a["is_dir"].as_bool().unwrap_or(false);
        let bd = b["is_dir"].as_bool().unwrap_or(false);
        bd.cmp(&ad).then(a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
    });
    v
}

fn json_resp(v: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&v).unwrap_or_default();
    Response::from_data(body).with_header(
        Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap(),
    )
}

fn text_resp(ct: &str, s: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(s).with_header(
        Header::from_bytes(&b"Content-Type"[..], ct.as_bytes()).unwrap(),
    )
}

fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(8086);
    let server = match Server::http(("0.0.0.0", port)) {
        Ok(s) => s,
        Err(e) => { eprintln!("绑定端口 {} 失败: {}", port, e); std::process::exit(1); }
    };
    eprintln!("istore-center listening on :{}", port);

    // 每请求一线程，避免慢请求（cpu_pct 采样/子进程）阻塞全部
    for req in server.incoming_requests() {
        std::thread::spawn(move || handle_req(req));
    }
}

fn handle_req(mut req: tiny_http::Request) {
    let url = req.url().to_string();
    let method = req.method().clone();
    let mut body = String::new();
    let _ = req.as_reader().take(65536).read_to_string(&mut body); // 上限 64KB 防 DoS

    let resp = if method == tiny_http::Method::Get && url == "/" {
            text_resp("text/html; charset=utf-8", INDEX_HTML.to_string())
        } else if method == tiny_http::Method::Get && url == "/app.js" {
            text_resp("application/javascript; charset=utf-8", APP_JS.to_string())
        } else if method == tiny_http::Method::Get && url == "/style.css" {
            text_resp("text/css; charset=utf-8", STYLE_CSS.to_string())
        } else if method == tiny_http::Method::Get && url == "/api/apps" {
            let apps: Vec<serde_json::Value> = catalog().iter().map(|a| {
                let mut st = unit_status(a.unit);
                if st.is_empty() {
                    st = if port_open(a.port) { "running".to_string() } else { "stopped".to_string() };
                }
                let port_ok = port_open(a.port);
                json!({
                    "id": a.id, "name": a.name, "icon": a.icon, "desc": a.desc,
                    "unit": a.unit, "port": a.port, "category": a.category,
                    "tags": a.tags, "author": a.author, "version": a.version,
                    "status": st, "enabled": unit_enabled(a.unit), "port_ok": port_ok,
                })
            }).collect();
            json_resp(json!({"apps": apps}))
        } else if method == tiny_http::Method::Post && url == "/api/action" {
            // CSRF 防护：跨源 POST 拒绝（无 Origin/Referer 视为本机）
            let origin = req.headers().iter().find(|h| h.field.equiv("Origin") || h.field.equiv("Referer"))
                .map(|h| h.value.as_str().to_string()).unwrap_or_default();
            if !origin.is_empty() && !origin.contains("127.0.0.1") && !origin.contains("localhost") && !origin.contains("192.168.2.164") && !origin.contains("100.122.70.99") {
                json_resp(json!({"ok": false, "err": "跨源请求拒绝"}))
            } else {
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));
            let unit = v["unit"].as_str().unwrap_or("").to_string();
            let act = v["action"].as_str().unwrap_or("").to_string();
            if unit.is_empty() || act.is_empty() {
                json_resp(json!({"ok": false, "err": "unit/action 缺"}))
            } else if !matches!(act.as_str(), "start" | "stop" | "restart" | "enable" | "disable") {
                json_resp(json!({"ok": false, "err": "action 必须 start/stop/restart/enable/disable"}))
            } else if !unit_whitelisted(&unit) {
                json_resp(json!({"ok": false, "err": "unit 不在应用目录"}))
            } else {
                let (ok, out) = run_systemctl(&act, &unit);
                json_resp(json!({"ok": ok, "output": out}))
            }
            }
        } else if method == tiny_http::Method::Get && url == "/api/system" {
            let (mt, ma) = mem_mb();
            let (l1, l5, l15) = loadavg();
            let up = uptime_sec();
            json_resp(json!({
                "mem_total_mb": mt, "mem_avail_mb": ma,
                "mem_pct": if mt > 0 { (100.0 * (mt - ma) as f64 / mt as f64).clamp(0.0, 100.0) } else { 0.0 },
                "load1": l1, "load5": l5, "load15": l15,
                "uptime_sec": up,
                "arch": std::env::consts::ARCH,
                "hostname": hostname(),
                "kernel": kernel(),
                "procs": proc_count(),
            }))
        } else if method == tiny_http::Method::Get && url == "/api/status" {
            let (mt, ma) = mem_mb();
            let (rx, tx) = net_rx_tx();
            json_resp(json!({
                "cpu_pct": cpu_pct(), "temp_c": temp_c(),
                "mem_total_mb": mt, "mem_avail_mb": ma,
                "mem_pct": if mt > 0 { (100.0 * (mt - ma) as f64 / mt as f64).clamp(0.0, 100.0) } else { 0.0 },
                "net_rx": rx, "net_tx": tx,
                "load1": loadavg().0, "uptime_sec": uptime_sec(),
                "ips": lan_ips(),
                "drives": drives(),
            }))
        } else if method == tiny_http::Method::Get && url == "/api/drives" {
            json_resp(json!({"drives": drives()}))
        } else if method == tiny_http::Method::Get && url.starts_with("/api/fs") {
            let q = url.split('?').nth(1).unwrap_or("");
            let path = q.split('&').find(|p| p.starts_with("path=")).map(|p| p[5..].to_string())
                .unwrap_or_else(|| "/".to_string());
            let path = urldecode(&path);
            let path = if path.is_empty() { String::from("/") } else { path };
            let show_hidden = q.split('&').any(|p| p == "show_hidden=1" || p == "show_hidden=true");
            // 路径防护：canonicalize + 白名单
            match safe_fs_path(&path) {
                Some(safe) => {
                    let (parent, base) = if safe == "/" { (String::from("/"), String::from("/")) } else {
                        let p = safe.trim_end_matches('/').to_string();
                        let idx = p.rfind('/').map(|i| i).unwrap_or(0);
                        (if idx == 0 { String::from("/") } else { p[..idx].to_string() }, p[idx..].trim_start_matches('/').to_string())
                    };
                    let cur = safe.clone();
                    json_resp(json!({"path": cur, "parent": parent, "base": base, "items": fs_list(&cur, show_hidden)}))
                }
                None => json_resp(json!({"error": "路径不允许", "path": path, "items": []})),
            }
        } else {
            text_resp("text/plain; charset=utf-8", "404".to_string())
        };
    let _ = req.respond(resp);
}
