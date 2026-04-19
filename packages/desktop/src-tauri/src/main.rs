// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// borrowed from https://github.com/skyline69/balatro-mod-manager
#[cfg(target_os = "linux")]
fn configure_display_backend() -> Option<String> {
    use librecode_lib::linux_windowing::{Backend, SessionEnv, select_backend};
    use std::env;

    let set_env_if_absent = |key: &str, value: &str| {
        if env::var_os(key).is_none() {
            // Safety: called during startup before any threads are spawned, so mutating the
            // process environment is safe.
            unsafe { env::set_var(key, value) };
        }
    };

    let session = SessionEnv::capture();
    let prefer_wayland = librecode_lib::linux_display::read_wayland().unwrap_or(false);
    let decision = select_backend(&session, prefer_wayland)?;

    match decision.backend {
        Backend::X11 => {
            set_env_if_absent("WINIT_UNIX_BACKEND", "x11");
            set_env_if_absent("GDK_BACKEND", "x11");
            set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        Backend::Wayland => {
            set_env_if_absent("WINIT_UNIX_BACKEND", "wayland");
            set_env_if_absent("GDK_BACKEND", "wayland");
            set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        Backend::Auto => {
            set_env_if_absent("GDK_BACKEND", "wayland,x11");
            set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    Some(decision.note)
}

fn main() {
    // Ensure loopback connections are never sent through proxy settings.
    // Some VPNs/proxies set HTTP_PROXY/HTTPS_PROXY/ALL_PROXY without excluding localhost.
    const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

    let upsert = |key: &str| {
        let mut items = std::env::var(key)
            .unwrap_or_default()
            .split(',')
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .collect::<Vec<_>>();

        for host in LOOPBACK {
            if items.iter().any(|v| v.eq_ignore_ascii_case(host)) {
                continue;
            }
            items.push(host.to_string());
        }

        // Safety: called during startup before any threads are spawned.
        unsafe { std::env::set_var(key, items.join(",")) };
    };

    upsert("NO_PROXY");
    upsert("no_proxy");

    #[cfg(target_os = "linux")]
    {
        if let Some(backend_note) = configure_display_backend() {
            eprintln!("{backend_note}");
        }
        // xdg-mime (spawned by tauri-plugin-deep-link at startup to register
        // librecode:// scheme handlers) checks $KDE_SESSION_VERSION and, if
        // set, calls `qtpaths` to locate the KDE config dir. On GNOME/Wayland
        // systems with KDE_SESSION_VERSION leaked into the env but no Qt
        // tooling installed, this prints:
        //
        //   /usr/bin/xdg-mime: line 885: qtpaths: command not found
        //
        // Harmless (xdg-mime falls through to the generic branch) but noisy.
        // Clear the var when we detect the lie: KDE_SESSION_VERSION set
        // AND no qtpaths/qtpaths6 on PATH. Leave it alone on real KDE
        // installs where qtpaths exists.
        clear_stale_kde_session_version();
    }

    librecode_lib::run()
}

#[cfg(target_os = "linux")]
fn clear_stale_kde_session_version() {
    use std::env;
    use std::path::Path;

    let Ok(_value) = env::var("KDE_SESSION_VERSION") else {
        return;
    };
    // xdg-mime's KDE branch specifically calls `qtpaths` (no suffix).
    // On KDE 6 systems, the binary is usually only installed as `qtpaths6`
    // and the plain `qtpaths` isn't on PATH — which is exactly the broken
    // state that produces 'qtpaths: command not found'. Check for the
    // exact name xdg-mime will invoke.
    let path = env::var_os("PATH").unwrap_or_default();
    let qtpaths_on_path = env::split_paths(&path).any(|dir| Path::new(&dir).join("qtpaths").exists());
    if !qtpaths_on_path {
        // Safety: called during startup before any threads are spawned.
        unsafe { env::remove_var("KDE_SESSION_VERSION") };
    }
}
