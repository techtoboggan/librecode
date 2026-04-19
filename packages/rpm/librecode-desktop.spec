# Pre-built Tauri desktop application — no debug package, no stripping
%global debug_package %{nil}
%global __strip /bin/true

Name:           librecode-desktop
Version:        0.0.0
Release:        1%{?dist}
Summary:        LibreCode — AI-powered desktop application
License:        MIT
URL:            https://github.com/techtoboggan/librecode

# x86_64 only for now — aarch64 desktop builds not yet in CI
ExclusiveArch:  x86_64

# Tarball of the Tauri-built RPM's contents, bundled by CI (no internet needed)
Source0:        librecode-desktop-x86_64.tar.gz

# Seamless upgrade from previous package names (Tauri's auto-generated names)
Obsoletes:      libre-code < %{version}-%{release}
Provides:       libre-code = %{version}-%{release}
Obsoletes:      LibreCode < %{version}-%{release}
Provides:       LibreCode = %{version}-%{release}

# Disable automatic dependency detection — the compiled Bun binary is ~132MB
# and triggers massive shared lib scanning that can hang COPR builders.
# We declare our actual deps explicitly below.
AutoReqProv:    no

# The desktop app ships a sidecar CLI at /usr/bin/librecode-cli that it
# spawns on launch. But users installing the desktop almost always also
# want the top-level `librecode` command on their PATH for terminal use
# (scripting, `librecode serve`, `librecode auth`, etc.). Pull in the
# companion CLI package from the same COPR repo.
# Versioned pin ensures desktop + CLI always match on upgrade.
Requires:       librecode = %{version}-%{release}

Requires:       webkit2gtk4.1
Requires:       gtk3
Requires:       glib2

%description
LibreCode desktop application. A graphical interface for the LibreCode
AI-powered coding agent that connects to LLM providers, understands
your codebase, and helps you build software faster.

%install
# The tarball contains filesystem paths relative to / (usr/bin/..., etc.)
tar -xzf %{SOURCE0} -C %{buildroot}

# Remove .build-id files — we provide pre-built binaries, not debuginfo
rm -rf %{buildroot}%{_libdir}/.build-id 2>/dev/null || true
rm -rf %{buildroot}/usr/lib/.build-id 2>/dev/null || true

# Tauri names the binary after productName (LibreCode). Create a
# librecode-desktop symlink so users can launch with a predictable name.
ln -sf LibreCode %{buildroot}%{_bindir}/librecode-desktop

%files
# Main binary + convenience symlink
%{_bindir}/LibreCode
%{_bindir}/librecode-desktop
# CLI sidecar (bundled by Tauri via externalBin)
%{_bindir}/librecode-cli
# Desktop entry and icons
%{_datadir}/applications/*.desktop
%{_datadir}/icons/hicolor/*/apps/*

%changelog
* Thu Apr 17 2026 techtoboggan <noreply@github.com> - 0.8.0-1
- First COPR release (v0.8.0)

* Mon Apr 13 2026 techtoboggan <noreply@github.com> - 0.0.0-1
- Initial COPR package
