#!/usr/bin/env bun

/**
 * Publish librecode to distribution channels.
 *
 * Stages:
 *   1. NPM: Publish platform-specific binary packages + wrapper package
 *   2. Docker: Build and push multi-arch container image
 *   3. AUR: Update PKGBUILD on AUR (stable releases only)
 *   4. Homebrew: Update formula in tap repo (stable releases only)
 *
 * Environment variables:
 *   GITHUB_TOKEN   Required for Homebrew tap updates
 *   GH_REPO        GitHub repo (default: techtoboggan/librecode)
 */

import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@librecode/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const ghRepo = process.env.GH_REPO || "techtoboggan/librecode"

// ── Discover built binaries ───────────────────────────────────

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const distPkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[distPkg.name] = distPkg.version
}
console.log("Binaries:", binaries)
const version = Object.values(binaries)[0]

// ── Stage 1: NPM ─────────────────────────────────────────────

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      bin: {
        librecode: `./bin/librecode`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version,
      license: pkg.license,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${name}`)
})
await Promise.all(tasks)
await $`cd ./dist/${pkg.name} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`

// ── Stage 2: Docker ───────────────────────────────────────────

const image = `ghcr.io/${ghRepo}`
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])
await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`

// ── Stage 3 & 4: AUR + Homebrew (stable releases only) ───────

if (!Script.preview) {
  const arm64Sha = await $`sha256sum ./dist/librecode-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/librecode-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/librecode-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/librecode-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // ── AUR PKGBUILD ──

  const binaryPkgbuild = [
    "# Maintainer: techtoboggan <tristan@techtoboggan.com>",
    "",
    "pkgname='librecode-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='AI-powered development tool for the terminal'",
    `url='https://github.com/${ghRepo}'`,
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('librecode')",
    "conflicts=('librecode')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/${ghRepo}/releases/download/v\${pkgver}\${_subver}/librecode-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,
    "",
    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/${ghRepo}/releases/download/v\${pkgver}\${_subver}/librecode-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./librecode "${pkgdir}/usr/bin/librecode"',
    "}",
    "",
  ].join("\n")

  for (const [aurPkg, pkgbuild] of [["librecode-bin", binaryPkgbuild]] as const) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${aurPkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${aurPkg}.git ./dist/aur-${aurPkg}`
        await $`cd ./dist/aur-${aurPkg} && git checkout master`
        await Bun.file(`./dist/aur-${aurPkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${aurPkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${aurPkg} && git add PKGBUILD .SRCINFO`
        await $`cd ./dist/aur-${aurPkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${aurPkg} && git push`
        break
      } catch (e) {
        continue
      }
    }
  }

  // ── Homebrew formula ──

  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "class Librecode < Formula",
    `  desc "AI-powered development tool for the terminal"`,
    `  homepage "https://github.com/${ghRepo}"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/${ghRepo}/releases/download/v${Script.version}/librecode-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "librecode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/${ghRepo}/releases/download/v${Script.version}/librecode-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "librecode"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/${ghRepo}/releases/download/v${Script.version}/librecode-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "librecode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/${ghRepo}/releases/download/v${Script.version}/librecode-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "librecode"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
  ].join("\n")

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = `https://x-access-token:${token}@github.com/techtoboggan/homebrew-tap.git`
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/librecode.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add librecode.rb`
  await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
  await $`cd ./dist/homebrew-tap && git push`
}
