use futures::{FutureExt, Stream, StreamExt, future};
use process_wrap::tokio::CommandWrap;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
#[cfg(windows)]
use process_wrap::tokio::{CommandWrapper, JobObject, KillOnDrop};
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, path::BaseDirectory};
use tauri_specta::Event;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
    task::JoinHandle,
};
use tokio_stream::wrappers::ReceiverStream;
use tracing::Instrument;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};

use crate::server::get_wsl_config;

#[cfg(windows)]
#[derive(Clone, Copy, Debug)]
// Keep this as a custom wrapper instead of process_wrap::CreationFlags.
// JobObject pre_spawn rewrites creation flags, so this must run after it.
struct WinCreationFlags;

#[cfg(windows)]
impl CommandWrapper for WinCreationFlags {
    fn pre_spawn(&mut self, command: &mut Command, _core: &CommandWrap) -> std::io::Result<()> {
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        Ok(())
    }
}

// XDG base-dir standard: user-level executables go in ~/.local/bin.
// Modern Linux distros (Ubuntu ≥22.04, Fedora, Arch with systemd) put
// this on PATH by default via /etc/profile.d. macOS users typically
// need to append it to their shell rc manually, but .local/bin is
// still the right target — it's the convention for per-user bins and
// matches what scripts/install.sh uses, so we stay consistent across
// install paths.
const CLI_INSTALL_DIR: &str = ".local/bin";
const CLI_BINARY_NAME: &str = "librecode";
const SHELL_ENV_TIMEOUT: Duration = Duration::from_secs(5);

#[allow(dead_code)]
#[derive(serde::Deserialize, Debug)]
pub struct ServerConfig {
    pub hostname: Option<String>,
    pub port: Option<u32>,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, Debug)]
pub struct Config {
    pub server: Option<ServerConfig>,
}

#[derive(Clone, Debug)]
pub enum CommandEvent {
    Stdout(String),
    Stderr(String),
    Error(String),
    Terminated(TerminatedPayload),
}

#[derive(Clone, Copy, Debug)]
pub struct TerminatedPayload {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct CommandChild {
    kill: mpsc::Sender<()>,
}

impl CommandChild {
    pub fn kill(&self) -> std::io::Result<()> {
        self.kill
            .try_send(())
            .map_err(|e| std::io::Error::other(e.to_string()))
    }
}

#[allow(dead_code)]
pub async fn get_config(app: &AppHandle) -> Option<Config> {
    let (events, _) = spawn_command(app, "debug config", &[]).ok()?;

    events
        .fold(String::new(), async |mut config_str, event| {
            if let CommandEvent::Stdout(s) = &event {
                config_str += s.as_str()
            }
            if let CommandEvent::Stderr(s) = &event {
                config_str += s.as_str()
            }

            config_str
        })
        .map(|v| serde_json::from_str::<Config>(&v))
        .await
        .ok()
}

fn get_cli_install_path() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        std::path::PathBuf::from(home)
            .join(CLI_INSTALL_DIR)
            .join(CLI_BINARY_NAME)
    })
}

pub fn get_sidecar_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    // Get binary with symlinks support
    tauri::process::current_binary(&app.env())
        .expect("Failed to get current binary")
        .parent()
        .expect("Failed to get parent dir")
        .join("librecode-cli")
}

fn is_cli_installed() -> bool {
    get_cli_install_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

/// Check if a system-installed `librecode` command is already on PATH.
/// Covers RPM (via Requires: librecode) and .deb (via postinst symlink)
/// install paths. When true, we don't need to auto-install into $HOME.
fn is_system_cli_installed() -> bool {
    let paths = ["/usr/bin/librecode", "/usr/local/bin/librecode"];
    paths.iter().any(|p| std::path::Path::new(p).exists())
}

#[tauri::command]
#[specta::specta]
pub fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    if cfg!(not(unix)) {
        return Err("CLI installation is only supported on macOS & Linux".to_string());
    }

    // We have the sidecar binary locally (via Tauri externalBin). No
    // network / install.sh needed — just copy the binary to the target
    // path, mark it executable, and we're done.
    //
    // Earlier implementation called the install.sh script with a
    // --binary <path> flag, but neither of our install scripts
    // (scripts/install.sh or the project-root `install`) supports that
    // flag — the shell download path would 404 and the copy never
    // happened. Silent failure during the desktop "install CLI" flow.
    let sidecar = get_sidecar_path(&app);
    if !sidecar.exists() {
        return Err("Sidecar binary not found".to_string());
    }

    let install_path =
        get_cli_install_path().ok_or_else(|| "Could not determine install path".to_string())?;

    if let Some(parent) = install_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create install dir: {}", e))?;
    }

    std::fs::copy(&sidecar, &install_path)
        .map_err(|e| format!("Failed to copy CLI binary: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&install_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set CLI permissions: {}", e))?;
    }

    Ok(install_path.to_string_lossy().to_string())
}

pub fn sync_cli(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        tracing::debug!("Skipping CLI sync for debug build");
        return Ok(());
    }

    // Zero-drama CLI availability: on Linux packaged installs (RPM .deb),
    // the system package manager puts librecode on PATH directly
    // (RPM: Requires: librecode pulls in the CLI package. .deb: postinst
    // symlinks /usr/bin/librecode-cli → /usr/bin/librecode). On macOS
    // and self-contained Linux archive/DMG installs, the desktop app
    // must install the sidecar itself on first launch so users can run
    // `librecode` from their terminal without any manual setup.
    //
    // Strategy:
    //   - If /usr/bin/librecode (or equivalent system path) exists:
    //     packaged install, nothing to do.
    //   - If ~/.librecode/bin/librecode exists: previous desktop install,
    //     fall through to the version-sync path below.
    //   - Otherwise: auto-install to ~/.librecode/bin silently.
    if is_system_cli_installed() {
        tracing::info!("System CLI installation found, skipping sync");
        return Ok(());
    }

    if !is_cli_installed() {
        tracing::info!("No CLI found, auto-installing to user bin directory");
        match install_cli(app.clone()) {
            Ok(path) => {
                tracing::info!(%path, "CLI auto-installed");
                return Ok(());
            }
            Err(e) => {
                // Non-fatal — the desktop app still works via its own
                // in-process sidecar. The user just can't run `librecode`
                // from the terminal yet.
                tracing::warn!(error = %e, "CLI auto-install failed (non-fatal)");
                return Ok(());
            }
        }
    }

    let cli_path =
        get_cli_install_path().ok_or_else(|| "Could not determine CLI install path".to_string())?;

    let output = std::process::Command::new(&cli_path)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to get CLI version: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get CLI version".to_string());
    }

    let cli_version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let cli_version = semver::Version::parse(&cli_version_str)
        .map_err(|e| format!("Failed to parse CLI version '{}': {}", cli_version_str, e))?;

    let app_version = app.package_info().version.clone();

    if cli_version >= app_version {
        tracing::info!(
            %cli_version, %app_version,
            "CLI is up to date, skipping sync"
        );
        return Ok(());
    }

    tracing::info!(
        %cli_version, %app_version,
        "CLI is older than app version, syncing"
    );

    install_cli(app)?;

    tracing::info!("Synced installed CLI");

    Ok(())
}

fn get_user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

fn is_wsl_enabled(_app: &tauri::AppHandle) -> bool {
    get_wsl_config(_app.clone()).is_ok_and(|v| v.enabled)
}

fn shell_escape(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }

    let mut escaped = String::from("'");
    escaped.push_str(&input.replace("'", "'\"'\"'"));
    escaped.push('\'');
    escaped
}

fn parse_shell_env(stdout: &[u8]) -> HashMap<String, String> {
    String::from_utf8_lossy(stdout)
        .split('\0')
        .filter_map(|line| {
            if line.is_empty() {
                return None;
            }

            let (key, value) = line.split_once('=')?;
            if key.is_empty() {
                return None;
            }

            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn command_output_with_timeout(
    mut cmd: std::process::Command,
    timeout: Duration,
) -> std::io::Result<Option<std::process::Output>> {
    let mut child = cmd.spawn()?;
    let start = Instant::now();

    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(Some);
        }

        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

enum ShellEnvProbe {
    Loaded(HashMap<String, String>),
    Timeout,
    Unavailable,
}

fn probe_shell_env(shell: &str, mode: &str) -> ShellEnvProbe {
    let mut cmd = std::process::Command::new(shell);
    cmd.args([mode, "-c", "env -0"]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    let output = match command_output_with_timeout(cmd, SHELL_ENV_TIMEOUT) {
        Ok(Some(output)) => output,
        Ok(None) => return ShellEnvProbe::Timeout,
        Err(error) => {
            tracing::debug!(shell, mode, ?error, "Shell env probe failed");
            return ShellEnvProbe::Unavailable;
        }
    };
    if !output.status.success() {
        tracing::debug!(shell, mode, "Shell env probe exited with non-zero status");
        return ShellEnvProbe::Unavailable;
    }
    let env = parse_shell_env(&output.stdout);
    if env.is_empty() {
        tracing::debug!(shell, mode, "Shell env probe returned empty env");
        return ShellEnvProbe::Unavailable;
    }

    ShellEnvProbe::Loaded(env)
}

fn is_nushell(shell: &str) -> bool {
    let shell_name = Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();
    shell_name == "nu" || shell_name == "nu.exe" || shell.to_ascii_lowercase().ends_with("\\nu.exe")
}
fn load_shell_env(shell: &str) -> Option<HashMap<String, String>> {
    if is_nushell(shell) {
        tracing::debug!(shell, "Skipping shell env probe for nushell");
        return None;
    }

    match probe_shell_env(shell, "-il") {
        ShellEnvProbe::Loaded(env) => {
            tracing::info!(
                shell,
                env_count = env.len(),
                "Loaded shell environment with -il"
            );
            return Some(env);
        }
        ShellEnvProbe::Timeout => {
            tracing::warn!(shell, "Interactive shell env probe timed out");
            return None;
        }
        ShellEnvProbe::Unavailable => {}
    }

    if let ShellEnvProbe::Loaded(env) = probe_shell_env(shell, "-l") {
        tracing::info!(
            shell,
            env_count = env.len(),
            "Loaded shell environment with -l"
        );
        return Some(env);
    }
    tracing::warn!(shell, "Falling back to app environment");
    None
}

fn merge_shell_env(
    shell_env: Option<HashMap<String, String>>,
    envs: Vec<(String, String)>,
) -> Vec<(String, String)> {
    let mut merged = shell_env.unwrap_or_default();
    for (key, value) in envs {
        merged.insert(key, value);
    }

    merged.into_iter().collect()
}

pub fn spawn_command(
    app: &tauri::AppHandle,
    args: &str,
    extra_env: &[(&str, String)],
) -> Result<(impl Stream<Item = CommandEvent> + 'static, CommandChild), std::io::Error> {
    let state_dir = app
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .expect("Failed to resolve app local data dir");

    let mut envs = vec![
        (
            "LIBRECODE_EXPERIMENTAL_ICON_DISCOVERY".to_string(),
            "true".to_string(),
        ),
        (
            "LIBRECODE_EXPERIMENTAL_FILEWATCHER".to_string(),
            "true".to_string(),
        ),
        ("LIBRECODE_CLIENT".to_string(), "desktop".to_string()),
        (
            "XDG_STATE_HOME".to_string(),
            state_dir.to_string_lossy().to_string(),
        ),
    ];
    envs.extend(
        extra_env
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone())),
    );

    let mut cmd = if cfg!(windows) {
        if is_wsl_enabled(app) {
            tracing::info!("WSL is enabled, spawning CLI server in WSL");
            let version = app.package_info().version.to_string();
            let mut script = vec![
                "set -e".to_string(),
                "BIN=\"$HOME/.librecode/bin/librecode\"".to_string(),
                "if [ ! -x \"$BIN\" ]; then".to_string(),
                format!(
                    "  curl -fsSL https://github.com/techtoboggan/librecode/install | bash -s -- --version {} --no-modify-path",
                    shell_escape(&version)
                ),
                "fi".to_string(),
            ];

            let mut env_prefix = vec![
                "LIBRECODE_EXPERIMENTAL_ICON_DISCOVERY=true".to_string(),
                "LIBRECODE_EXPERIMENTAL_FILEWATCHER=true".to_string(),
                "LIBRECODE_CLIENT=desktop".to_string(),
                "XDG_STATE_HOME=\"$HOME/.local/state\"".to_string(),
            ];
            env_prefix.extend(
                envs.iter()
                    .filter(|(key, _)| key != "LIBRECODE_EXPERIMENTAL_ICON_DISCOVERY")
                    .filter(|(key, _)| key != "LIBRECODE_EXPERIMENTAL_FILEWATCHER")
                    .filter(|(key, _)| key != "LIBRECODE_CLIENT")
                    .filter(|(key, _)| key != "XDG_STATE_HOME")
                    .map(|(key, value)| format!("{}={}", key, shell_escape(value))),
            );

            script.push(format!("{} exec \"$BIN\" {}", env_prefix.join(" "), args));

            let mut cmd = Command::new("wsl");
            cmd.args(["-e", "bash", "-lc", &script.join("\n")]);
            cmd
        } else {
            let sidecar = get_sidecar_path(app);
            let mut cmd = Command::new(sidecar);
            cmd.args(args.split_whitespace());

            for (key, value) in envs {
                cmd.env(key, value);
            }

            cmd
        }
    } else {
        let sidecar = get_sidecar_path(app);
        let shell = get_user_shell();
        let envs = merge_shell_env(load_shell_env(&shell), envs);

        let line = if shell.ends_with("/nu") {
            format!("^\"{}\" {}", sidecar.display(), args)
        } else {
            format!("\"{}\" {}", sidecar.display(), args)
        };

        let mut cmd = Command::new(shell);
        cmd.args(["-l", "-c", &line]);

        for (key, value) in envs {
            cmd.env(key, value);
        }

        cmd
    };

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());

    let mut wrap = CommandWrap::from(cmd);

    #[cfg(unix)]
    {
        wrap.wrap(ProcessGroup::leader());
    }

    #[cfg(windows)]
    {
        wrap.wrap(JobObject).wrap(WinCreationFlags).wrap(KillOnDrop);
    }

    let mut child = wrap.spawn()?;
    let guard = Arc::new(tokio::sync::RwLock::new(()));
    let (tx, rx) = mpsc::channel(256);
    let (kill_tx, mut kill_rx) = mpsc::channel(1);

    let stdout = spawn_pipe_reader(
        tx.clone(),
        guard.clone(),
        BufReader::new(child.stdout().take().unwrap()),
        CommandEvent::Stdout,
    );
    let stderr = spawn_pipe_reader(
        tx.clone(),
        guard.clone(),
        BufReader::new(child.stderr().take().unwrap()),
        CommandEvent::Stderr,
    );

    tokio::task::spawn(async move {
        let mut kill_open = true;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(err) => break Err(err),
            }

            tokio::select! {
                msg = kill_rx.recv(), if kill_open => {
                    if msg.is_some() {
                        let _ = child.start_kill();
                    }
                    kill_open = false;
                }
                _ = tokio::time::sleep(Duration::from_millis(100)) => {}
            }
        };

        match status {
            Ok(status) => {
                let payload = TerminatedPayload {
                    code: status.code(),
                    signal: signal_from_status(status),
                };
                let _ = tx.send(CommandEvent::Terminated(payload)).await;
            }
            Err(err) => {
                let _ = tx.send(CommandEvent::Error(err.to_string())).await;
            }
        }

        stdout.abort();
        stderr.abort();
    });

    let event_stream = ReceiverStream::new(rx);
    let event_stream = sqlite_migration::logs_middleware(app.clone(), event_stream);

    Ok((event_stream, CommandChild { kill: kill_tx }))
}

fn signal_from_status(status: std::process::ExitStatus) -> Option<i32> {
    #[cfg(unix)]
    return status.signal();

    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

pub fn serve(
    app: &AppHandle,
    hostname: &str,
    port: u32,
    password: &str,
) -> (CommandChild, oneshot::Receiver<TerminatedPayload>) {
    let (exit_tx, exit_rx) = oneshot::channel::<TerminatedPayload>();

    tracing::info!(port, "Spawning sidecar");

    let envs = [
        ("LIBRECODE_SERVER_USERNAME", "librecode".to_string()),
        ("LIBRECODE_SERVER_PASSWORD", password.to_string()),
    ];

    let (events, child) = spawn_command(
        app,
        format!("--print-logs --log-level WARN serve --hostname {hostname} --port {port}").as_str(),
        &envs,
    )
    .expect("Failed to spawn librecode");

    let mut exit_tx = Some(exit_tx);
    tokio::spawn(
        events
            .for_each(move |event| {
                match event {
                    CommandEvent::Stdout(line) => {
                        tracing::info!("{line}");
                    }
                    CommandEvent::Stderr(line) => {
                        tracing::info!("{line}");
                    }
                    CommandEvent::Error(err) => {
                        tracing::error!("{err}");
                    }
                    CommandEvent::Terminated(payload) => {
                        tracing::info!(
                            code = ?payload.code,
                            signal = ?payload.signal,
                            "Sidecar terminated"
                        );

                        if let Some(tx) = exit_tx.take() {
                            let _ = tx.send(payload);
                        }
                    }
                }

                future::ready(())
            })
            .instrument(tracing::info_span!("sidecar")),
    );

    (child, exit_rx)
}

pub mod sqlite_migration {
    use super::*;

    #[derive(
        tauri_specta::Event, serde::Serialize, serde::Deserialize, Clone, Copy, Debug, specta::Type,
    )]
    #[serde(tag = "type", content = "value")]
    pub enum SqliteMigrationProgress {
        InProgress(u8),
        Done,
    }

    pub(super) fn logs_middleware(
        app: AppHandle,
        stream: impl Stream<Item = CommandEvent>,
    ) -> impl Stream<Item = CommandEvent> {
        let app = app.clone();
        let mut done = false;

        stream.filter_map(move |event| {
            if done {
                return future::ready(Some(event));
            }

            future::ready(match &event {
                CommandEvent::Stdout(s) | CommandEvent::Stderr(s) => {
                    if let Some(s) = s.strip_prefix("sqlite-migration:").map(|s| s.trim()) {
                        if let Ok(progress) = s.parse::<u8>() {
                            let _ = SqliteMigrationProgress::InProgress(progress).emit(&app);
                        } else if s == "done" {
                            done = true;
                            let _ = SqliteMigrationProgress::Done.emit(&app);
                        }

                        None
                    } else {
                        Some(event)
                    }
                }
                _ => Some(event),
            })
        })
    }
}

fn spawn_pipe_reader<F: Fn(String) -> CommandEvent + Send + Copy + 'static>(
    tx: mpsc::Sender<CommandEvent>,
    guard: Arc<tokio::sync::RwLock<()>>,
    pipe_reader: impl AsyncBufRead + Send + Unpin + 'static,
    wrapper: F,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let _lock = guard.read().await;
        let reader = BufReader::new(pipe_reader);

        read_line(reader, tx, wrapper).await;
    })
}

async fn read_line<F: Fn(String) -> CommandEvent + Send + Copy + 'static>(
    reader: BufReader<impl AsyncBufRead + Unpin>,
    tx: mpsc::Sender<CommandEvent>,
    wrapper: F,
) {
    let mut lines = reader.lines();
    loop {
        let line = lines.next_line().await;

        match line {
            Ok(s) => {
                if let Some(s) = s {
                    let _ = tx.clone().send(wrapper(s)).await;
                }
            }
            Err(e) => {
                let tx_ = tx.clone();
                let _ = tx_.send(CommandEvent::Error(e.to_string())).await;
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn parse_shell_env_supports_null_delimited_pairs() {
        let env = parse_shell_env(b"PATH=/usr/bin:/bin\0FOO=bar=baz\0\0");

        assert_eq!(env.get("PATH"), Some(&"/usr/bin:/bin".to_string()));
        assert_eq!(env.get("FOO"), Some(&"bar=baz".to_string()));
    }

    #[test]
    fn parse_shell_env_ignores_invalid_entries() {
        let env = parse_shell_env(b"INVALID\0=empty\0OK=1\0");

        assert_eq!(env.len(), 1);
        assert_eq!(env.get("OK"), Some(&"1".to_string()));
    }

    #[test]
    fn merge_shell_env_keeps_explicit_overrides() {
        let mut shell_env = HashMap::new();
        shell_env.insert("PATH".to_string(), "/shell/path".to_string());
        shell_env.insert("HOME".to_string(), "/tmp/home".to_string());

        let merged = merge_shell_env(
            Some(shell_env),
            vec![
                ("PATH".to_string(), "/desktop/path".to_string()),
                ("LIBRECODE_CLIENT".to_string(), "desktop".to_string()),
            ],
        )
        .into_iter()
        .collect::<HashMap<_, _>>();

        assert_eq!(merged.get("PATH"), Some(&"/desktop/path".to_string()));
        assert_eq!(merged.get("HOME"), Some(&"/tmp/home".to_string()));
        assert_eq!(merged.get("LIBRECODE_CLIENT"), Some(&"desktop".to_string()));
    }

    #[test]
    fn is_nushell_handles_path_and_binary_name() {
        assert!(is_nushell("nu"));
        assert!(is_nushell("/opt/homebrew/bin/nu"));
        assert!(is_nushell("C:\\Program Files\\nu.exe"));
        assert!(!is_nushell("/bin/zsh"));
    }
}
