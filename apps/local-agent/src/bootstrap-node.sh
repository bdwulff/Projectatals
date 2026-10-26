# User-local Node bootstrap for the unsigned Mac launcher. Sourced by zsh; no code is fetched and piped to a shell.
# Official release + published SHA256 values verified 26 October 2026:
# https://nodejs.org/en/blog/release/v24.22.1
jarvis_node_arch() {
  case "$1" in arm64) printf 'arm64' ;; x86_64) printf 'x64' ;; *) printf 'Unsupported Mac architecture.\n' >&2; return 1 ;; esac
}
jarvis_node_checksum() {
  case "$1" in
    arm64) printf '89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7' ;;
    x64) printf 'd132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035' ;;
    *) return 1 ;;
  esac
}
jarvis_node_archive_paths_safe() {
  # Require a single fixed top-level directory; reject absolute/parent traversal names.
  /usr/bin/awk -v prefix="$1/" 'BEGIN{ok=1} /^\// || /(^|\/)\.\.($|\/)/ {ok=0} index($0,prefix)!=1 {ok=0} END{exit !ok}'
}
jarvis_install_node() {
  [ "$(/usr/bin/uname -s)" = 'Darwin' ] || { printf 'The bundled runtime installer supports macOS only.\n' >&2; return 1; }
  jarvis_arch=$(jarvis_node_arch "$(/usr/bin/uname -m)") || return 1
  jarvis_version='v24.22.1'
  jarvis_folder="node-${jarvis_version}-darwin-${jarvis_arch}"
  jarvis_archive="${jarvis_folder}.tar.gz"
  jarvis_expected=$(jarvis_node_checksum "$jarvis_arch") || return 1
  jarvis_runtime_root="$HOME/Library/Application Support/Jarvis/runtime"
  jarvis_runtime_node="$jarvis_runtime_root/$jarvis_folder/bin/node"
  if [ -x "$jarvis_runtime_node" ]; then printf '%s\n' "$jarvis_runtime_node"; return 0; fi
  printf 'Jarvis needs a local Node runtime. Download the official Node %s for this Mac into your own Application Support folder? No administrator access or global PATH changes. [y/N] ' "$jarvis_version" >&2
  read -r jarvis_answer
  case "$jarvis_answer" in y|Y|yes|YES) ;; *) printf 'Runtime download cancelled.\n' >&2; return 1 ;; esac
  jarvis_work=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/jarvis-node.XXXXXX") || return 1
  if ! /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 --output "$jarvis_work/$jarvis_archive" "https://nodejs.org/dist/$jarvis_version/$jarvis_archive"; then /bin/rm -rf "$jarvis_work"; return 1; fi
  if ! /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 60 --output "$jarvis_work/SHASUMS256.txt" "https://nodejs.org/dist/$jarvis_version/SHASUMS256.txt"; then /bin/rm -rf "$jarvis_work"; return 1; fi
  jarvis_manifest=$(/usr/bin/awk -v name="$jarvis_archive" '$2==name {print $1}' "$jarvis_work/SHASUMS256.txt")
  jarvis_actual=$(/usr/bin/shasum -a 256 "$jarvis_work/$jarvis_archive" | /usr/bin/awk '{print $1}')
  if [ "$jarvis_manifest" != "$jarvis_expected" ] || [ "$jarvis_actual" != "$jarvis_expected" ]; then printf 'Node checksum verification failed. Nothing was extracted or run.\n' >&2; /bin/rm -rf "$jarvis_work"; return 1; fi
  if ! /usr/bin/tar -tzf "$jarvis_work/$jarvis_archive" | jarvis_node_archive_paths_safe "$jarvis_folder"; then printf 'Node archive paths were rejected.\n' >&2; /bin/rm -rf "$jarvis_work"; return 1; fi
  /bin/mkdir -p "$jarvis_runtime_root" || { /bin/rm -rf "$jarvis_work"; return 1; }
  /usr/bin/tar -xzf "$jarvis_work/$jarvis_archive" -C "$jarvis_runtime_root" || { /bin/rm -rf "$jarvis_work"; return 1; }
  /bin/rm -rf "$jarvis_work"
  [ -x "$jarvis_runtime_node" ] || return 1
  printf '%s\n' "$jarvis_runtime_node"
}
