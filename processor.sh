#!/bin/bash
set -e

cd "$(dirname "$0")"

# echo "Downloading raw bang data..."
# curl -s -o bangs_kagi.json "https://raw.githubusercontent.com/kagisearch/bangs/master/data/bangs.json"
# curl -s -o bangs_ddg.json "https://duckduckgo.com/bang.js"
# echo "Download complete."

echo "Creating u/d domain diff..."
jq -n --argfile kagi bangs_kagi.json --argfile ddg bangs_ddg.json \
'
  # Safely extracts domain from a URL string. Handles missing paths, query strings, and ports.
  def get_domain_from_url:
    if type == "string" then
      # 1. Strip protocol, 2. Strip query string, 3. Strip path, 4. Strip port
      sub("^https?://"; "") | split("?")[0] | split("/")[0] | split(":")[0]
    else
      empty # If .u is not a string, skip this entry
    end;

  # Process a list of bangs (kagi or ddg) to find diffs
  def find_diffs:
    map(
      .u as $url | .d as $d |
      ($url | get_domain_from_url) as $d_from_u |
      if $d_from_u and ($d != $d_from_u) then
        { (.t): [$d, $d_from_u] }
      else
        empty
      end
    ) | add;

  ($kagi | find_diffs) as $kagi_diffs |
  ($ddg | find_diffs) as $ddg_diffs |
  $kagi_diffs + $ddg_diffs
' > u_d_diff.json
echo "u/d domain diff created."

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

echo "Processing complete."
