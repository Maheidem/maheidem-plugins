# MCP-over-stdio helpers for the server tests. Source after lib/common.sh.
SERVER="$PLUGIN_ROOT/scripts/pi-mcp-server.mjs"
# The server stamps records with the Claude session it runs under; a run from
# inside a Claude session would otherwise inherit that session's id. Tests that
# need one set it per server.
unset CLAUDE_CODE_SESSION_ID

# inner_for_id <file> <id> -> the inner result JSON (content[0].text) of the
# tools/call response with that id, or {} if absent.
inner_for_id() {
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    let found = null;
    for (const l of lines) {
      try { const o = JSON.parse(l); if (o.id === Number(process.argv[2]) && o.result) found = o; } catch {}
    }
    process.stdout.write(found ? found.result.content[0].text : "{}");
  ' "$1" "$2"
}

# json_for_id <file> <id> -> the JSON part of that response's text: 0.11 tool
# results may start with headline lines before the JSON (always the last line).
json_for_id() {
  inner_for_id "$1" "$2" | tail -n 1
}

# head_for_id <file> <id> -> the headline lines before the JSON (may be empty)
head_for_id() {
  inner_for_id "$1" "$2" | sed '$d'
}

# field_of <inner-json> <js-expr over d> -> value (JSON for non-strings)
field_of() {
  node -e '
    const d = JSON.parse(process.argv[1] || "{}");
    const v = eval("d." + process.argv[2]);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v === undefined ? null : v));
  ' "$1" "$2"
}

# count_lines <file> <fixed-string> -> number of lines containing it
count_lines() {
  grep -cF "$2" "$1" 2>/dev/null || true
}

# count_pushes <file> -> channel notifications in a server's output, the
# once-per-server push check (event "probe") left out
count_pushes() {
  { grep -F 'notifications/claude/channel' "$1" 2>/dev/null || true; } | { grep -vcF '"event":"probe"' || true; }
}

# call <id> <tool> <arguments-json> -> one tools/call JSON-RPC line
call() {
  printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2" "$3"
}

# json_obj key value [key value ...] -> compact JSON object; values that look
# like integers become numbers. Use this instead of hand-escaped \" inside
# "$(...)": macOS bash 3.2 mangles those and brace-expands the result.
json_obj() {
  node -e '
    const a = process.argv.slice(1); const o = {};
    for (let i = 0; i < a.length; i += 2) o[a[i]] = /^[0-9]+$/.test(a[i + 1]) ? Number(a[i + 1]) : a[i + 1];
    process.stdout.write(JSON.stringify(o));
  ' "$@"
}

# feed <out-file> <entries...> -- one server process (killed after
# FEED_TIMEOUT seconds, default 120); entries are JSON lines,
# "SLEEP <sec>" pauses, or "WAIT_FOR <fixed-string-without-spaces> <sec>",
# which blocks until that string appears in the server's output (for steps
# that depend on what the server already said), or "SNAP <child-dir> <file>",
# which writes "<meta consumed_seq> <last done seq>" to <file> mid-run, or
# "SH <shell command>", run as-is at that point (kill a stub, copy meta.json;
# what it prints goes to the server's stdin, so it can send a computed line).
feed() {
  local out="$1"; shift
  local script pidf
  script="$(make_scratch)/feeder.sh"
  pidf="${script%.sh}.pid"
  {
    echo '#!/usr/bin/env bash'
    echo 'set -uo pipefail'
    echo '{'
    echo "  printf '%s\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}'"
    echo '  sleep 0.2'
    local entry
    for entry in "$@"; do
      case "$entry" in
        SLEEP\ *) echo "  sleep ${entry#SLEEP }" ;;
        WAIT_FOR\ *)
          local _kw needle secs
          read -r _kw needle secs <<< "$entry"
          echo "  for _i in \$(seq 1 \$(( $secs * 10 ))); do grep -qF '$needle' '$out' 2>/dev/null && break; [ -s '$pidf' ] && ! kill -0 \$(cat '$pidf') 2>/dev/null && break; sleep 0.1; done"
          ;;
        SNAP\ *)
          local _kw2 sdir sfile
          read -r _kw2 sdir sfile <<< "$entry"
          echo "  echo \"\$(meta_of '$sdir' consumed_seq) \$(last_seq_of '$sdir' done)\" > '$sfile'"
          ;;
        SH\ *) echo "  ${entry#SH }" ;;
        *) printf "  printf '%%s\\\\n' '%s'\n" "$entry" ;;
      esac
    done
    echo '  sleep 1'
    # The server records its pid so WAIT_FOR stops waiting once it is gone.
    # FEED_LAUNCH replaces "node" (a launcher that spawns the server as its
    # child, e.g. to give it a Claude-looking parent argv).
    echo "} | sh -c 'echo \$\$ > \"$pidf\"; exec timeout ${FEED_TIMEOUT:-120} ${FEED_LAUNCH:-node} \"$SERVER\"' > '$out' 2>${FEED_STDERR:-/dev/null} || true"
  } > "$script"
  bash "$script"
}

# child_dir <project-dir> <name> -> the server's event-store dir for that child
child_dir() {
  echo "$CLAUDE_PLUGIN_DATA/projects/$(pi_session_slug "$1")/children/$2"
}

# event_types <child-dir> -> comma-separated event types from events.jsonl, in file order
event_types() {
  node -e '
    const fs = require("fs");
    let raw = ""; try { raw = fs.readFileSync(process.argv[1] + "/events.jsonl", "utf8"); } catch {}
    process.stdout.write(raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).type).join(","));
  ' "$1"
}

# meta_of <child-dir> <js-expr over m> -> value from meta.json (JSON for non-strings)
meta_of() {
  node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1] + "/meta.json", "utf8"));
    const v = eval("m." + process.argv[2]);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v === undefined ? null : v));
  ' "$1" "$2"
}

# last_seq_of <child-dir> <type> -> seq of the last event of that type (or 0)
last_seq_of() {
  node -e '
    const fs = require("fs");
    let raw = ""; try { raw = fs.readFileSync(process.argv[1] + "/events.jsonl", "utf8"); } catch {}
    const e = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.type === process.argv[2]).pop();
    process.stdout.write(String(e ? e.seq : 0));
  ' "$1" "$2"
}

# The feeder script runs in a child bash: SNAP steps call these.
export -f meta_of last_seq_of
