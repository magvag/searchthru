#!/bin/bash
set -e

cd "$(dirname "$0")"

# echo "Downloading raw bang data..."
# curl -s -o bangs_kagi.json "https://raw.githubusercontent.com/kagisearch/bangs/master/data/bangs.json"
# curl -s -o bangs_ddg.json "https://duckduckgo.com/bang.js"
# echo "Download complete."

echo "Processing and flattening bangs..."
jq --sort-keys '
  map(
    .u |= (
      gsub("%3A"; ":") | gsub("%2F"; "/") | gsub("%3F"; "?") | gsub("%3D"; "=") | gsub("%26"; "&") | gsub("%20"; "+")
    )
  ) |
  map(
    if .d == "duckduckgo.com" and (.u | test("^https?://duckduckgo\\.com/")) then
      .u |= (
        sub("^https?://duckduckgo\\.com/"; "")
        | if endswith("+{{{s}}}") and startswith("?q=site:") then
            (sub("\\+{{{s}}}$"; "") | sub("\\?q="; "?q={{{s}}}+"))
          else
            .
          end
      )
    else
      .
    end
  )
  | reduce .[] as $item ({}; . + {($item.t): $item.u})
' bangs_ddg.json > flat_bangs_ddg.json
jq --sort-keys '
  map(
    .u |= (
      gsub("%3A"; ":") | gsub("%2F"; "/") | gsub("%3F"; "?") | gsub("%3D"; "=") | gsub("%26"; "&") | gsub("%20"; "+")
    )
  ) |
  map(if .d == "kagi.com" and (.u | startswith("/search?q=")) then .u |= ltrimstr("/search") else . end) | reduce .[] as $item ({}; . + {($item.t): $item.u} + reduce ($item.ts // [])[] as $ts ({}; . + {($ts): $item.u}))' bangs_kagi.json > flat_bangs_kagi.json
echo "Flattening complete."

echo "Creating diff files..."
jq -n --argfile kagi flat_bangs_kagi.json --argfile ddg flat_bangs_ddg.json \
  '$kagi | keys_unsorted as $kagi_keys | $ddg | keys_unsorted as $ddg_keys | ($kagi_keys - $ddg_keys) | map({(.): $kagi[.]}) | add' > kagi_ddg_diff.json
jq -n --argfile ddg flat_bangs_ddg.json --argfile kagi flat_bangs_kagi.json \
  '$ddg | keys_unsorted as $ddg_keys | $kagi | keys_unsorted as $kagi_keys | ($ddg_keys - $kagi_keys) | map({(.): $ddg[.]}) | add' > ddg_kagi_diff.json
echo "Diff files created."

echo "Creating URL diff file..."
jq -n --argfile kagi flat_bangs_kagi.json --argfile ddg flat_bangs_ddg.json \
  '
  def normalize_url: sub("^https?://"; "");
  ($kagi | keys) as $kagi_keys | ($ddg | keys) as $ddg_keys | ($kagi_keys - ($kagi_keys - $ddg_keys)) as $common_keys | reduce $common_keys[] as $key ({};
    if ($kagi[$key] | normalize_url) != ($ddg[$key] | normalize_url) then
      . + {($key): [$kagi[$key], $ddg[$key]]}
    else
      .
    end
  )
' > url_diff.json
echo "URL diff file created."

echo "Processing complete."
