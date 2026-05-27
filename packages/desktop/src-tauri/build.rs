fn main() {
    // Phase 53: the e2e-testing capability is added at RUNTIME via
    // app.handle().add_capability(include_str!(...)) in lib.rs's setup hook
    // (gated on the e2e-testing feature), NOT as a static capability file.
    //
    // Why: a static capabilities/*.json referencing `playwright:default` is
    // validated by tauri_build::build() at compile time against the plugin's
    // permission manifest. On fresh CI runners that validation failed with a
    // build-script error (the manifest ordering differs from a warm local
    // target — could not be reproduced locally, only in clean CI). Adding the
    // capability at runtime sidesteps build-time validation entirely: the
    // plugin's `playwright:default` permission is still compiled into the ACL
    // (it ships with the crate), so the runtime resolve succeeds, but there is
    // no static capability for tauri_build to choke on. Production builds
    // (no feature) never embed or add it. See ADR-010 + phase-52-spec.md.
    tauri_build::build()
}
