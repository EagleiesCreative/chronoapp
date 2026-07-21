#!/usr/bin/env bash
#
# Diagnose "The signature was created with a different key than the one provided".
#
# The updater only accepts an update whose signature was made by the private
# half of the pubkey compiled into the installed app. This prints the key ID in
# tauri.conf.json and the key ID that actually signed a release, so you can see
# whether they match.
#
# Usage:
#   ./scripts/check-updater-keys.sh              # checks the latest release
#   ./scripts/check-updater-keys.sh v2.0.0       # checks a specific tag
#   ./scripts/check-updater-keys.sh --local      # identifies your local ~/.tauri keys
#
set -euo pipefail

REPO="EagleiesCreative/chronoapp"
TAG="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Local key identification ────────────────────────────────────────────────
# Which key ID does each private key on this machine belong to? Signs a scratch
# file with each one (you'll be prompted for the key password) and reads the ID
# back out of the signature.
if [ "$TAG" = "--local" ]; then
  shopt -s nullglob
  KEYS=("$HOME"/.tauri/*.key)
  if [ ${#KEYS[@]} -eq 0 ]; then
    echo "No private keys found in ~/.tauri"
    echo "If they aren't anywhere else either, generate a fresh pair:"
    echo "  npx tauri signer generate -w ~/.tauri/framr.key"
    exit 1
  fi

  PROBE="$(mktemp)"
  trap 'rm -f "$PROBE" "$PROBE.sig"' EXIT
  echo probe > "$PROBE"

  for KEY in "${KEYS[@]}"; do
    echo "── $KEY"
    if npx --yes tauri signer sign -f "$KEY" "$PROBE" >/dev/null 2>&1; then
      SIG="$PROBE.sig" python3 <<'PY'
import base64, binascii, os
sig = base64.b64decode(open(os.environ['SIG']).read()).decode(errors='replace')
raw = base64.b64decode(sig.splitlines()[1])
print('   key ID: %s' % binascii.hexlify(raw[2:10][::-1]).decode().upper())
PY
    else
      echo "   could not sign with this key (wrong password?)"
    fi
    rm -f "$PROBE.sig"
  done
  exit 0
fi

fetch_release() {
  # Empty output means 404 / rate limit rather than a parse problem.
  curl -sfL "$1" || true
}

if [ -z "$TAG" ]; then
  LATEST_JSON="$(fetch_release "https://api.github.com/repos/$REPO/releases/latest")"
  if [ -z "$LATEST_JSON" ]; then
    echo "Could not reach the GitHub API (no published release yet, or rate limited)."
    exit 1
  fi
  TAG="$(printf '%s' "$LATEST_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
fi

TAG_JSON="$(fetch_release "https://api.github.com/repos/$REPO/releases/tags/$TAG")"
if [ -z "$TAG_JSON" ]; then
  echo "No release found for tag '$TAG'."
  echo "Still building, still a draft, or the tag name is wrong — check the Actions tab."
  exit 1
fi

SIG_URL="$(printf '%s' "$TAG_JSON" |
  python3 -c 'import json,sys; a=[x["browser_download_url"] for x in json.load(sys.stdin)["assets"] if x["name"].endswith(".sig")]; print(a[0] if a else "")')"

if [ -z "$SIG_URL" ]; then
  echo "No .sig assets on $TAG — was it built with createUpdaterArtifacts enabled?"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -sfL "$SIG_URL" -o "$TMP/asset.sig"

CONF="$ROOT/src-tauri/tauri.conf.json" SIG="$TMP/asset.sig" URL="$SIG_URL" TAG="$TAG" \
python3 <<'PY'
import base64, binascii, json, os

def key_id(b64_line):
    # minisign layout: 2-byte algorithm, then the 8-byte key ID (little endian).
    raw = base64.b64decode(b64_line)
    return binascii.hexlify(raw[2:10][::-1]).decode().upper()

cfg = json.load(open(os.environ['CONF']))
pub = base64.b64decode(cfg['plugins']['updater']['pubkey']).decode().strip()
conf_id = key_id(pub.splitlines()[-1])

sig = base64.b64decode(open(os.environ['SIG']).read()).decode(errors='replace')
sig_id = key_id(sig.splitlines()[1])

print('Public key in tauri.conf.json : %s' % conf_id)
print('   (every installed app demands a signature from this key)')
print('Signature on %-17s: %s' % (os.environ['TAG'], sig_id))
print('   (from %s)' % os.environ['URL'].rsplit('/', 1)[-1])
print()

if conf_id == sig_id:
    print('MATCH — the release is signed with the key the app expects.')
    print('If updates still fail, the installed build predates this pubkey;')
    print('reinstall it once from a release built after the key was set.')
else:
    print('MISMATCH')
    print('  config expects: %s' % conf_id)
    print('  release signed: %s' % sig_id)
    print()
    print('TAURI_SIGNING_PRIVATE_KEY in GitHub secrets is not the private half')
    print('of the pubkey in tauri.conf.json. Either restore the private key for')
    print('%s, or adopt %s by putting its public key in' % (conf_id, sig_id))
    print('tauri.conf.json — existing installs then need one manual reinstall.')
PY
