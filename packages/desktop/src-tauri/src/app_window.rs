//! Detached MCP-app windows.
//!
//! Phase 49: each dock pane can be popped out into its own Tauri
//! webview window. The window URL points at the SolidJS detached
//! route (`/detached/:server/:uriHash`); the window state plugin
//! persists position/size/monitor per label across restarts.
//!
//! Labels: `detached-<server>-<uriHash>` where uriHash is a stable
//! FNV-1a hex digest of the full URI. This keeps the same window
//! identity across Tauri versions and across URI representations
//! that differ only in URL-encoding.

use std::ops::Deref;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Stable 8-char hex digest of a string using FNV-1a (32-bit).
pub fn uri_hash(uri: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in uri.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{:08x}", hash)
}

/// Build the canonical label for a detached app window.
pub fn window_label(server: &str, uri: &str) -> String {
    // Replace anything not [a-zA-Z0-9_-] in `server` so the Tauri label
    // validator accepts it (labels must match `[a-zA-Z0-9_-]+`).
    let safe_server: String = server
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    format!("detached-{}-{}", safe_server, uri_hash(uri))
}

/// One detached app window.
pub struct DetachedAppWindow(WebviewWindow);

impl Deref for DetachedAppWindow {
    type Target = WebviewWindow;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DetachedAppWindow {
    /// Open a detached window for the given app. If one already exists
    /// with the same label, focuses it instead of creating a duplicate.
    pub fn open(
        app: &AppHandle,
        server: &str,
        uri: &str,
        app_name: &str,
    ) -> Result<Self, tauri::Error> {
        let label = window_label(server, uri);
        if let Some(existing) = app.get_webview_window(&label) {
            existing.set_focus()?;
            return Ok(Self(existing));
        }

        // Compose the URL. URL-encode the URI for the path segment.
        let encoded_server = urlencoding::encode(server);
        let encoded_uri = urlencoding::encode(uri);
        let url = format!("/detached/{}/{}", encoded_server, encoded_uri);

        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
            .title(format!("{} — LibreCode", app_name))
            .inner_size(800.0, 600.0)
            .min_inner_size(400.0, 300.0)
            .resizable(true)
            .decorations(true)
            .build()?;

        Ok(Self(window))
    }

    /// Close the detached window if it exists. No-op otherwise.
    pub fn close(app: &AppHandle, server: &str, uri: &str) -> Result<(), tauri::Error> {
        let label = window_label(server, uri);
        if let Some(window) = app.get_webview_window(&label) {
            window.close()?;
        }
        Ok(())
    }

    /// Check if a detached window for this app is currently open.
    pub fn is_open(app: &AppHandle, server: &str, uri: &str) -> bool {
        let label = window_label(server, uri);
        app.get_webview_window(&label).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_is_stable() {
        assert_eq!(uri_hash("ui://multica/board"), uri_hash("ui://multica/board"));
        assert_ne!(uri_hash("ui://a"), uri_hash("ui://b"));
    }

    #[test]
    fn label_sanitises_server_name() {
        let label = window_label("acme/weather", "ui://x");
        assert!(label.starts_with("detached-acme_weather-"));
        assert!(!label.contains('/'));
    }

    #[test]
    fn label_is_deterministic() {
        assert_eq!(window_label("s", "u"), window_label("s", "u"));
    }
}
