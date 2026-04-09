{
  description = "LibreCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (pkgs: {
        # Minimal shell for CLI-only development
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_20
            pkg-config
            openssl
            git
            ripgrep
          ];
        };

        # Full shell including Tauri desktop dependencies
        desktop = pkgs.mkShell {
          packages = with pkgs; [
            # Core
            bun
            nodejs_20
            pkg-config
            openssl
            git
            ripgrep

            # Rust toolchain for Tauri
            rustc
            cargo
            cargo-tauri

            # Tauri Linux dependencies
            dbus
            glib
            gtk3        # Required by libappindicator at runtime
            gtk4
            libsoup_3
            librsvg
            glib-networking
            webkitgtk_4_1
          ] ++ lib.optionals stdenv.isLinux [
            libappindicator
            gst_all_1.gstreamer
            gst_all_1.gst-plugins-base
            gst_all_1.gst-plugins-good
            gst_all_1.gst-plugins-bad
          ];

          # Set LD_LIBRARY_PATH so the Tauri dev binary can find Nix-provided libs
          LD_LIBRARY_PATH = lib.makeLibraryPath (with pkgs; [
            gtk3
            gtk4
            glib
            dbus
            openssl
            librsvg
            libsoup_3
            webkitgtk_4_1
            glib-networking
          ] ++ lib.optionals stdenv.isLinux [
            libappindicator
            gst_all_1.gstreamer
            gst_all_1.gst-plugins-base
          ]);
        };
      });

      overlays = {
        default =
          final: _prev:
          let
            node_modules = final.callPackage ./nix/node_modules.nix {
              inherit rev;
            };
            librecode = final.callPackage ./nix/librecode.nix {
              inherit node_modules;
            };
            desktop = final.callPackage ./nix/desktop.nix {
              librecode = librecode;
            };
          in
          {
            inherit librecode;
            librecode-desktop = desktop;
          };
      };

      packages = forEachSystem (
        pkgs:
        let
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
          };
          librecode = pkgs.callPackage ./nix/librecode.nix {
            inherit node_modules;
          };
          desktop = pkgs.callPackage ./nix/desktop.nix {
            librecode = librecode;
          };
        in
        {
          default = librecode;
          inherit librecode desktop;
          # Updater derivation with fakeHash - build fails and reveals correct hash
          node_modules_updater = node_modules.override {
            hash = pkgs.lib.fakeHash;
          };
        }
      );
    };
}
