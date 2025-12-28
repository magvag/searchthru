#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Downloading raw bang data..."
curl -s -o kagi_raw.json "https://raw.githubusercontent.com/kagisearch/bangs/master/data/bangs.json"
curl -s -o ddg_raw.json "https://duckduckgo.com/bang.js"
echo "Download complete."


echo "Processing and flattening bangs..."

# ----------------------------
#  DDG
# ----------------------------
jq --sort-keys '
  map(
    .u |= (
      gsub("%3A"; ":")
      | gsub("%2F"; "/")
      | gsub("%3F"; "?")
      | gsub("%3D"; "=")
      | gsub("%26"; "&")
      | gsub("%20"; "+")
    )
  )
  |
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
  |
  reduce .[] as $item ({};
    . + {
      ($item.t): (
        {
          u: $item.u
        }
        +
        (if $item.fmt? then {fmt: $item.fmt} else {} end)
      )
    }
  )
' ddg_raw.json > ddg.json


# ----------------------------
#  KAGI
# ----------------------------
jq --sort-keys '
  map(
    .u |= (
      gsub("%3A"; ":")
      | gsub("%2F"; "/")
      | gsub("%3F"; "?")
      | gsub("%3D"; "=")
      | gsub("%26"; "&")
      | gsub("%20"; "+")
    )
  )
  |
  map(
    if .d == "kagi.com" and (.u | startswith("/search?q=")) then
      .u |= ltrimstr("/search")
    else
      .
    end
  )
  |
  reduce .[] as $item ({};
    .
    + {
        ($item.t): (
          {
            u: $item.u
          }
          +
          (if $item.fmt? then {fmt: $item.fmt} else {} end)
        )
      }
    +
      # Add aliases from .ts[]
      (reduce ($item.ts // [])[] as $ts ({};
        . + {
          ($ts): (
            {
              u: $item.u
            }
            +
            (if $item.fmt? then {fmt: $item.fmt} else {} end)
          )
        }
      ))
  )
' kagi_raw.json > kagi.json

echo "Flattening complete."
echo "Processing complete."
