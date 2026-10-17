#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  1. Install the LTS version from https://nodejs.org (opening it now)"
  echo "  2. Then double-click start-mac.command again."
  echo ""
  open "https://nodejs.org"
  read -n 1 -s -r -p "  Press any key to close"
  exit 1
fi
echo "  Using Node.js $(node --version)"
node server.js
echo ""
read -n 1 -s -r -p "  Server stopped. Press any key to close"
