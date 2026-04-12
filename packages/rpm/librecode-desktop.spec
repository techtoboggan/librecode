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

%files
%{_bindir}/LibreCode
%{_datadir}/applications/com.librecode.desktop*.desktop
%{_datadir}/icons/hicolor/*/apps/com.librecode.desktop*

%changelog
* Sun Apr 13 2026 techtoboggan <noreply@github.com> - 0.0.0-1
- Initial COPR package
