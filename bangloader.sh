#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Downloading raw bang data..."
curl -s -o data/kagi_raw.json "https://raw.githubusercontent.com/kagisearch/bangs/master/data/bangs.json"
curl -s -o data/ddg_raw.json "https://duckduckgo.com/bang.js"

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
            (sub("\\+{{{s}}}$"; "") | sub("\\?q="; "{{{s}}}+"))
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
        +
        (if $item.ad? then {ad: $item.ad} else {} end)
      )
    }
  )
' data/ddg_raw.json > data/ddg.json

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
      .u |= ltrimstr("/search?q=")
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
          +
          (if $item.ad? then {ad: $item.ad} else {} end)
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
            +
            (if $item.ad? then {ad: $item.ad} else {} end)
          )
        }
      ))
  )
' data/kagi_raw.json > data/kagi.json

echo "All done."
