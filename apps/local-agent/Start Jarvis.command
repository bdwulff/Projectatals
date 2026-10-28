#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h}/../.."
source apps/local-agent/src/bootstrap-node.sh
JARVIS_NODE=''
if command -v node >/dev/null 2>&1; then
  if node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)'; then JARVIS_NODE="$(command -v node)"; fi
fi
if [[ -z "$JARVIS_NODE" ]]; then
  JARVIS_NODE=$(jarvis_install_node) || { print 'Jarvis did not install or start. You can install Node.js LTS from https://nodejs.org/en/download and try again.'; read '?Press Return to close.'; exit 1; }
fi
"$JARVIS_NODE" apps/local-agent/src/server.mjs setup
print 'Your private key file is ~/.atlas-local/device.json. Copy its token into the local sign-in screen. Never paste the key in chat.'
open -e "$HOME/.atlas-local/device.json"
"$JARVIS_NODE" apps/local-agent/src/server.mjs start --open
