#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <journal-folder>\n' "$0"
  printf 'Example: %s "~/Documents/My Journals"\n' "$0"
}

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

# Also accept a quoted ~/ path, which the shell does not expand itself.
folder=$1
if [[ $folder == '~/'* ]]; then
  folder="$HOME/${folder:2}"
fi

if [[ ! -d $folder ]]; then
  printf 'Error: not a directory: %s\n' "$folder" >&2
  exit 1
fi

# Resolve the user's path before switching to the Compose project directory.
folder=$(cd -- "$folder" && pwd -P)
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd -- "$script_dir"

exec docker compose run --rm \
  -v "$folder:/journals:ro" \
  search-journal python index.py /journals
