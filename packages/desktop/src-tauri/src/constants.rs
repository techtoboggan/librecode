use tauri_plugin_window_state::StateFlags;

pub const SETTINGS_STORE: &str = "librecode.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
// Auto-update is disabled on Linux — users should use their package manager
// (RPM/COPR, AUR, Nix, Flatpak).
pub const UPDATER_ENABLED: bool =
    option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some() && !cfg!(target_os = "linux");

pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}
