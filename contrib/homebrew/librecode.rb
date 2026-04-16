class Librecode < Formula
  desc "Local-first AI coding agent — fork of opencode"
  homepage "https://github.com/techtoboggan/librecode"
  version "1.0.0-preview.1"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/techtoboggan/librecode/releases/download/v1.0.0-preview.1/librecode-darwin-arm64.tar.gz"
      # Filled in after release: sha256 matches SHA256SUMS in the GitHub Release.
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    # Intel macOS: no darwin-x64 artifact in the preview release (macos-13
    # runners have poor availability on GH Actions). Users on Intel Macs can
    # install via `bun add -g librecode` or use the Linux-x64 build under
    # Rosetta 2. Re-add once we have capacity for that target.
  end

  on_linux do
    on_intel do
      url "https://github.com/techtoboggan/librecode/releases/download/v1.0.0-preview.1/librecode-linux-x64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_arm do
      url "https://github.com/techtoboggan/librecode/releases/download/v1.0.0-preview.1/librecode-linux-arm64.tar.gz"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    bin.install "librecode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/librecode --version")
  end
end
