#!/usr/bin/env bash
set -e

REPO="fabriziosalmi/mixi"
echo "🎧 Installing MIXI from latest release..."

# Get OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

# Fetch latest release data
LATEST_URL="https://api.github.com/repos/$REPO/releases/latest"
RELEASE_JSON=$(curl -sL "$LATEST_URL")

download_and_install() {
  local pattern=$1
  local exclude=$2
  
  # Extract download URL for the specific asset
  local download_url=""
  if [ -n "$exclude" ]; then
    download_url=$(echo "$RELEASE_JSON" | grep -o "https://github.com[^\"]*" | grep -E "$pattern" | grep -v "$exclude" | head -n 1)
  else
    download_url=$(echo "$RELEASE_JSON" | grep -o "https://github.com[^\"]*" | grep -E "$pattern" | head -n 1)
  fi
  
  if [ -z "$download_url" ] || [ "$download_url" = "null" ]; then
    echo "❌ Error: Could not find asset matching '$pattern' in the latest release."
    exit 1
  fi
  
  local filename=$(basename "$download_url")
  echo "⬇️  Downloading $filename..."
  
  local tmp_dir=$(mktemp -d)
  local download_dest="$tmp_dir/$filename"
  
  curl -L -# "$download_url" -o "$download_dest"
  
  if [ "$OS" = "Darwin" ]; then
    echo "🍏 Installing macOS App to /Applications..."
    # Mount DMG and copy
    hdiutil attach "$download_dest" -nobrowse -quiet -mountpoint "$tmp_dir/mount"
    
    # Remove older version if present
    if [ -d "/Applications/Mixi.app" ]; then
        rm -rf "/Applications/Mixi.app"
    fi
    
    cp -R "$tmp_dir/mount/Mixi.app" /Applications/
    hdiutil detach "$tmp_dir/mount" -quiet
    
    # Remove quarantine attribute to allow unsigned execution
    xattr -cr /Applications/Mixi.app || true
    
    echo "✅ Installed successfully to /Applications/Mixi.app"
    echo "🎵 You can launch MIXI from your Launchpad!"
  elif [ "$OS" = "Linux" ]; then
    echo "🐧 Installing Linux AppImage..."
    mkdir -p ~/.local/bin
    cp "$download_dest" ~/.local/bin/Mixi
    chmod +x ~/.local/bin/Mixi
    echo "✅ Installed successfully to ~/.local/bin/Mixi"
    echo "🎵 You can launch it by typing: ~/.local/bin/Mixi"
  fi
  
  rm -rf "$tmp_dir"
}

if [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    download_and_install "arm64.*\.dmg$"
  else
    download_and_install "\.dmg$" "arm64"
  fi
elif [ "$OS" = "Linux" ]; then
  download_and_install "\.AppImage$"
else
  echo "Unsupported OS: $OS"
  echo "Please download the Windows executable manually from the releases page."
  exit 1
fi
