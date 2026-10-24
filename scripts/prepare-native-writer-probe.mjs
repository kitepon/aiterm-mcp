import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = path.join(process.cwd(), 'native-writer-source');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), '66cf61354c473b35d4f0c06c57384fc46d61ffdb');
const file = path.join(root, 'src/pane.rs');
let source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('pub fn spawn_pane_write_queue('), end = source.indexOf('/// Cached resolved shell path', start);
assert.ok(start > 0 && end > start);
let body = source.slice(start, end);
assert.ok(body.includes('if inner.write_all(&buf).is_err() {'));
body = body.replace('if inner.write_all(&buf).is_err() {', `let outcome = inner.write_all(&buf);
                native_writer_diagnostic("write", buf.len(), outcome.is_ok(), outcome.as_ref().err().and_then(|e| e.raw_os_error()));
                if outcome.is_err() {`);
body = body.replace('if broken {\n                    continue;', 'if broken {\n                    native_writer_diagnostic("discard", buf.len(), false, None);\n                    continue;');
const helper = `fn native_writer_diagnostic(phase: &str, bytes: usize, ok: bool, os_error: Option<i32>) {
    if phase == "write" && ok && bytes == 256 && std::env::var("AITERM_TEST_NATIVE_RESUME_AFTER_FIRST_WRITE").ok().as_deref() == Some("1") {
        if let Ok(gate) = std::env::var("AITERM_TEST_NATIVE_START_GATE") {
            if std::path::Path::new(&format!("{}.ready", gate)).exists() {
                if std::fs::OpenOptions::new().write(true).create_new(true).open(format!("{}.trigger", gate)).is_ok() {
                    let _ = std::fs::write(format!("{}.release", gate), "after-first-256-byte-write");
                }
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let file = dir.join(format!("diagnostic-writer-{}.jsonl", std::process::id()));
            if let Ok(mut log) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
                let row = serde_json::json!({
                    "server_pid": std::process::id(), "thread": format!("{:?}", std::thread::current().id()),
                    "session": std::env::var("PSMUX_TARGET_SESSION").ok(),
                    "at_ms": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
                    "phase": phase, "bytes": bytes, "ok": ok, "os_error": os_error
                });
                let _ = std::io::Write::write_all(&mut log, format!("{}\\n", row).as_bytes());
            }
        }
    }
}

`;
source = source.slice(0, start) + helper + body + source.slice(end);
fs.writeFileSync(file, source);
console.log('native_writer_source=66cf61354c473b35d4f0c06c57384fc46d61ffdb+write-result-only-instrumentation');
if (process.argv.includes('--direct-init')) {
  const ptyFile = path.join(root, 'crates/portable-pty-psmux/src/win/psuedocon.rs');
  let pty = fs.readFileSync(ptyFile, 'utf8').replaceAll('\r\n', '\n');
  const prepare = 'let res = unsafe {\n            CreateProcessW(';
  assert.equal(pty.split(prepare).length, 2);
  pty = pty.replace(prepare, `let direct_init_gate = std::env::var("AITERM_TEST_NATIVE_START_GATE").ok()
            .filter(|_| cmd_os.to_string_lossy().to_ascii_lowercase().contains("bash"));
        let res = unsafe {
            CreateProcessW(`);
  const flags = 'EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,';
  assert.equal(pty.split(flags).length, 2);
  pty = pty.replace(flags, 'EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | if direct_init_gate.is_some() { 0x00000004 } else { 0 },');
  const thread = 'let _main_thread = unsafe { OwnedHandle::from_raw_handle(pi.hThread as _) };';
  assert.equal(pty.split(thread).length, 2);
  pty = pty.replace(thread, thread + `
        if let Some(gate) = direct_init_gate {
            std::thread::spawn(move || {
                let _ = std::fs::write(format!("{}.ready", gate), "suspended");
                let until = std::time::Instant::now() + std::time::Duration::from_secs(15);
                while !std::path::Path::new(&format!("{}.release", gate)).exists() && std::time::Instant::now() < until {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                let previous_suspend = unsafe { ResumeThread(_main_thread.as_raw_handle() as _) };
                let _ = std::fs::write(format!("{}.resumed", gate), previous_suspend.to_string());
            });
        }
  `);
  fs.writeFileSync(ptyFile, pty);
  console.log('native_direct_init_gate=fixture-only-CREATE_SUSPENDED-before-first-Bash');
}
