fn main() {
    // Phase 52 Sub-C: conditionally stage the e2e-testing capabilities JSON
    // BEFORE tauri_build::build() scans the capabilities/ directory.
    //
    // The `playwright:default` permission is only valid when
    // tauri-plugin-playwright is compiled in (--features e2e-testing).
    // Leaving the capability active in a non-feature build would make
    // tauri_build abort with "unknown permission playwright:default".
    //
    // Convention: the source lives at capabilities/e2e-testing.src.json
    // (not auto-discovered). This build script copies it to the live path
    // when the feature is active, and removes the live path otherwise.
    // Source lives OUTSIDE capabilities/ so tauri_build's glob scan doesn't
    // pick it up when the feature is inactive.
    let e2e_src = "e2e-testing-capability.json";
    let e2e_live = "capabilities/e2e-testing.json";
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_E2E_TESTING");
    println!("cargo:rerun-if-changed={}", e2e_src);

    if std::env::var("CARGO_FEATURE_E2E_TESTING").is_ok() {
        std::fs::copy(e2e_src, e2e_live).expect("failed to copy e2e-testing capabilities");
    } else {
        // Silently remove the live file if it was left over from a prior
        // e2e build so production builds don't accidentally pick it up.
        let _ = std::fs::remove_file(e2e_live);
    }

    tauri_build::build()
}
