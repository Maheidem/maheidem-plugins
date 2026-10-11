{
  "_doc": "Per-kind defaults that mods.py new writes into mod.json. Each kind has variants (the design letters), ready (the text the first screen shows), pointer (the glyph per variant that is not the default), fixtures (the spec of the old generator 4.2, kept for the lint of the skill) and domain (the domain block of mods.py domain, design 1.2; null for kind mixed). The template files of each kind are the output of its domain: mods.py domain --check and lint-skill compare them.",
  "kinds": {
    "pane-list": {
      "variants": ["A", "B", "C", "D"],
      "ready": "Scenario",
      "pointer": {"D": ">"},
      "fixtures": {"count": 4, "overflow": 60, "fields": {"text": "sentence", "age": "age"}},
      "domain": {
        "v": 1,
        "noun": ["item", "items"],
        "fields": [
          {"name": "text", "type": "text"},
          {"name": "age", "type": "age"}
        ],
        "title": "text",
        "detail": ["age"],
        "actions": [
          {"key": "a", "verb": "add", "kind": "add"},
          {"key": "d", "verb": "delete", "kind": "delete"}
        ],
        "scenarios": [
          {"name": "normal", "role": "normal"},
          {"name": "empty", "role": "empty"},
          {"name": "loading", "role": "loading"},
          {"name": "error", "role": "error"},
          {"name": "overflow", "role": "overflow"},
          {"name": "save-fails", "role": "fails"}
        ],
        "count": 4,
        "overflow": 60,
        "world": [],
        "band": null,
        "say": null,
        "on": null,
        "parts": [],
        "keep": 5,
        "probe": null,
        "texts": {}
      }
    },
    "pane-simple": {
      "variants": ["A", "B", "C", "D"],
      "ready": "Scenario",
      "pointer": {},
      "fixtures": null,
      "domain": {
        "v": 1,
        "noun": ["item", "items"],
        "fields": [
          {"name": "text", "type": "text"},
          {"name": "state", "type": "enum", "values": ["ok", "warn", "err"], "tones": {"ok": "ok", "warn": "warn", "err": "err"}},
          {"name": "age", "type": "age"}
        ],
        "title": "text",
        "detail": [],
        "actions": [
          {"key": "c", "verb": "clear", "kind": "clear"},
          {"key": "r", "verb": "refresh", "kind": "refresh"}
        ],
        "scenarios": [
          {"name": "normal", "role": "normal"},
          {"name": "empty", "role": "empty"},
          {"name": "overflow", "role": "overflow"}
        ],
        "count": 4,
        "overflow": 60,
        "world": [],
        "band": null,
        "say": null,
        "on": null,
        "parts": [],
        "keep": 5,
        "probe": null,
        "texts": {}
      }
    },
    "band": {
      "variants": ["A", "B", "C", "D"],
      "ready": "Scenario",
      "pointer": {},
      "fixtures": null,
      "domain": {
        "v": 1,
        "noun": ["item", "items"],
        "fields": [
          {"name": "text", "type": "text"},
          {"name": "state", "type": "enum", "values": ["waiting", "working", "failed", "done"], "tones": {"waiting": "warn", "working": "muted", "failed": "err", "done": "ok"}},
          {"name": "note", "type": "text", "values": ["Book the team room for Monday", "Update the onboarding page", "Archive the old dashboards", "Review the cache change", "Pay the domain renewal", "Clean up the feature flags", "Write the incident summary", "Call the vendor about the invoice before Friday", "Fix the flaky login test", "Ask for the design file", "Rename the staging bucket", "Check disk use on the build host", "Reply to the audit email", "Draft the release plan"]},
          {"name": "age", "type": "age"}
        ],
        "title": "text",
        "detail": ["state", "note", "age"],
        "actions": [
          {"key": "d", "verb": "done", "kind": "mark", "set": {"state": "done"}},
          {"key": "r", "verb": "refresh", "kind": "refresh"}
        ],
        "scenarios": [
          {"name": "normal", "role": "normal"},
          {"name": "empty", "role": "empty"},
          {"name": "error", "role": "error"},
          {"name": "overflow", "role": "overflow"}
        ],
        "count": 3,
        "overflow": 40,
        "world": [],
        "band": {"lead": null, "counts": "state", "idle": "show"},
        "say": null,
        "on": null,
        "parts": [],
        "keep": 5,
        "probe": null,
        "texts": {}
      }
    },
    "status-toast": {
      "variants": ["A"],
      "ready": "Scenario",
      "pointer": {},
      "fixtures": null,
      "domain": {
        "v": 1,
        "noun": ["event", "events"],
        "fields": [
          {"name": "text", "type": "text"}
        ],
        "title": "text",
        "detail": [],
        "actions": [],
        "scenarios": [
          {"name": "normal", "role": "normal"}
        ],
        "count": 1,
        "overflow": null,
        "world": [],
        "band": null,
        "say": "{text}",
        "on": "turn.complete",
        "parts": ["toast"],
        "keep": 5,
        "probe": "rm -rf {dir}",
        "texts": {}
      }
    },
    "guard": {
      "variants": ["A"],
      "ready": "Refused",
      "pointer": {},
      "fixtures": null,
      "domain": {
        "v": 1,
        "noun": null,
        "fields": [],
        "title": null,
        "detail": [],
        "actions": [],
        "scenarios": [
          {"name": "deny", "role": "deny"}
        ],
        "count": null,
        "overflow": null,
        "world": [],
        "band": null,
        "say": null,
        "on": null,
        "parts": ["guard"],
        "keep": null,
        "probe": "rm -rf {dir}",
        "texts": {}
      }
    },
    "command": {
      "variants": ["A"],
      "ready": "Scenario",
      "pointer": {},
      "fixtures": null,
      "domain": {
        "v": 1,
        "noun": ["item", "items"],
        "fields": [
          {"name": "text", "type": "text"}
        ],
        "title": "text",
        "detail": [],
        "actions": [],
        "scenarios": [
          {"name": "normal", "role": "normal"},
          {"name": "empty", "role": "empty"}
        ],
        "count": 2,
        "overflow": null,
        "world": [],
        "band": null,
        "say": "{text}",
        "on": "tool.call",
        "parts": ["command"],
        "keep": 5,
        "probe": "rm -rf {dir}",
        "texts": {}
      }
    },
    "mixed": {
      "variants": ["A", "B", "C", "D"],
      "ready": "Scenario",
      "pointer": {"D": ">"},
      "fixtures": null,
      "domain": null
    }
  }
}
