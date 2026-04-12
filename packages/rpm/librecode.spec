# Pre-built binary package — no debug package, no stripping
%global debug_package %{nil}
%global __strip /bin/true

Name:           librecode
Version:        0.0.0
Release:        1%{?dist}
Summary:        AI-powered terminal coding agent
License:        MIT
URL:            https://github.com/techtoboggan/librecode

# Both arch tarballs are bundled in the SRPM so the build works with
# internet access disabled (Fedora packaging policy).
Source0:        librecode-linux-x64.tar.gz
Source1:        librecode-linux-arm64.tar.gz

ExclusiveArch:  x86_64 aarch64

Requires:       glibc

%description
LibreCode is an AI-powered development tool for the terminal.

It connects to LLM providers (Anthropic, OpenAI, Google, local models,
and more), understands your codebase, and helps you build software faster.

Features include multi-provider support, MCP server integration, session
branching, permission management with audit logging, and proper Linux
packaging via COPR, Flatpak, and Nix.

%prep
%ifarch x86_64
tar -xzf %{SOURCE0}
%endif
%ifarch aarch64
tar -xzf %{SOURCE1}
%endif

%build
# Pre-built binary — nothing to compile

%install
install -D -m 0755 librecode %{buildroot}%{_bindir}/librecode

%files
%{_bindir}/librecode

%changelog
* Sun Apr 13 2026 techtoboggan <noreply@github.com> - 0.0.0-1
- Package created
