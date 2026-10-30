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

// 运行 shell 命令并返回 (exit_ok, stdout)。
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
    let server = Server::http(("0.0.0.0", port)).expect("bind 失败");
    eprintln!("istore-center listening on :{}", port);

    for mut req in server.incoming_requests() {
        let url = req.url().to_string();
        let method = req.method().clone();
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);

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
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));
            let unit = v["unit"].as_str().unwrap_or("").to_string();
            let act = v["action"].as_str().unwrap_or("").to_string();
            if unit.is_empty() || act.is_empty() {
                json_resp(json!({"ok": false, "err": "unit/action 缺"}))
            } else if !matches!(act.as_str(), "start" | "stop" | "restart") {
                json_resp(json!({"ok": false, "err": "action 必须 start/stop/restart"}))
            } else {
                let (ok, out) = run_cmd(&format!("systemctl --user {} {}", act, unit));
                json_resp(json!({"ok": ok, "output": out}))
            }
        } else if method == tiny_http::Method::Get && url == "/api/system" {
            let (mt, ma) = mem_mb();
            let (l1, l5, l15) = loadavg();
            let up = uptime_sec();
            json_resp(json!({
                "mem_total_mb": mt, "mem_avail_mb": ma,
                "mem_pct": if mt > 0 { (100.0 * (mt - ma) as f64 / mt as f64) } else { 0.0 },
                "load1": l1, "load5": l5, "load15": l15,
                "uptime_sec": up,
                "arch": std::env::consts::ARCH,
            }))
        } else {
            text_resp("text/plain; charset=utf-8", "404".to_string())
        };
        let _ = req.respond(resp);
    }
}
