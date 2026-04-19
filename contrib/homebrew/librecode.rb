class Librecode < Formula
  desc "Local-first AI coding agent — fork of opencode"
  homepage "https://github.com/techtoboggan/librecode"
  version "0.9.19"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/techtoboggan/librecode/releases/download/v0.9.19/librecode-darwin-arm64.zip"
      sha256 "02882b5bdda01b008b4577960bfd73ab58220c303838962bec9352c1eca6c83c"
    end
    # Intel macOS: no darwin-x64 artifact shipped yet (macos-13 runners
    # have poor availability on GH Actions). Intel-Mac users can install
    # via `bun add -g librecode` or the Linux-x64 build under Rosetta 2.
    # Re-add once we have runner capacity for the target.
  end

  on_linux do
    on_intel do
      url "https://github.com/techtoboggan/librecode/releases/download/v0.9.19/librecode-linux-x64.tar.gz"
      sha256 "ea56279c6b12cf8b8ba3002d77a1116ceca359f0f9881d215678c8455e1060b2"
    end
    on_arm do
      url "https://github.com/techtoboggan/librecode/releases/download/v0.9.19/librecode-linux-arm64.tar.gz"
      sha256 "3553e1706ccdc4e3dc54025416b5f00d0c9654a0b9fa5897ddb9b0f1ce2e5caf"
    end
  end

  def install
    bin.install "librecode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/librecode --version")
  end
end
