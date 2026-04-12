# Pre-built binary package — no debug package needed
%global debug_package %{nil}
%global __strip /bin/true

Name:           librecode
Version:        0.0.0
Release:        1%{?dist}
Summary:        AI-powered terminal coding agent
License:        MIT
URL:            https://github.com/techtoboggan/librecode

# Only ship for architectures we produce binaries for
ExclusiveArch:  x86_64 aarch64

# Runtime dependency: glibc (the binary is dynamically linked)
Requires:       glibc

%description
LibreCode is an AI-powered development tool for the terminal.

It connects to LLM providers (Anthropic, OpenAI, Google, local models,
and more), understands your codebase, and helps you build software faster.

Features include multi-provider support, MCP server integration, session
branching, permission management with audit logging, and proper Linux
packaging via COPR, Flatpak, and Nix.

%prep
# Download the architecture-specific pre-built binary from the GitHub release.
# The version macro is injected by the CI workflow via rpmbuild --define.
%ifarch x86_64
curl -fL -o librecode.tar.gz \
  https://github.com/techtoboggan/librecode/releases/download/v%{version}/librecode-linux-x64.tar.gz
%endif
%ifarch aarch64
curl -fL -o librecode.tar.gz \
  https://github.com/techtoboggan/librecode/releases/download/v%{version}/librecode-linux-arm64.tar.gz
%endif
tar -xzf librecode.tar.gz

%build
# Pre-built binary — nothing to compile

%install
install -D -m 0755 librecode %{buildroot}%{_bindir}/librecode

%files
%{_bindir}/librecode

%changelog
* Sun Apr 13 2026 techtoboggan <noreply@github.com> - 0.0.0-1
- Package created
