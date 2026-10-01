import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SETTINGS = {
  questions_per_turn: { default: 5, min: 0, max: 100, special: ["unlimited"] },
  turn_timeout_minutes: { default: 60, min: 1, max: 1440, special: ["unlimited"] },
  question_wait_minutes: { default: 10, min: 1, max: 1440 },
  max_live_children: { default: 4, min: 1, max: 16 },
  idle_park_minutes: { default: 5, min: 1, max: 1440, special: ["never"] },
  default_thinking: { default: "pi-default", special: ["off", "minimal", "low", "medium", "high", "xhigh", "max", "pi-default"] }
};
export function parseSetting(key, value) {
  const spec = SETTINGS[key];
  if (!spec) return null;
  if (spec.special?.includes(value)) return value;
  if (spec.min === undefined) return null;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) value = Number(value);
  return Number.isInteger(value) && value >= spec.min && value <= spec.max ? value : null;
}
export function userSettingsPath() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "pi-delegate.json");
}
function frontmatter(raw) { return raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/); }
export function resolveSettings(cwd) {
  const projectPath = path.join(cwd, ".claude", "pi-delegate.local.md");
  const userPath = userSettingsPath();
  const warnings = [], project = {}, user = {};
  try {
    const fm = frontmatter(fs.readFileSync(projectPath, "utf8"));
    if (fm) for (const line of fm[1].split(/\r?\n/)) {
      const match = line.match(/^([a-z_]+)\s*:\s*(.*?)\s*$/);
      if (!match || !Object.hasOwn(SETTINGS, match[1])) continue;
      let value = match[2];
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      project[match[1]] = value;
    }
  } catch (err) { if (err.code !== "ENOENT") warnings.push("Cannot read project settings"); }
  try {
    const data = JSON.parse(fs.readFileSync(userPath, "utf8"));
    if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("expected object");
    Object.assign(user, data);
  } catch (err) { if (err.code !== "ENOENT") warnings.push("Cannot read user settings"); }
  const settings = {};
  for (const [key, spec] of Object.entries(SETTINGS)) {
    const values = {};
    for (const [scope, data] of [["project", project], ["user", user]]) {
      values[scope] = Object.hasOwn(data, key) ? parseSetting(key, data[key]) : null;
      if (Object.hasOwn(data, key) && values[scope] === null) warnings.push(`Invalid ${scope} ${key}; ignoring it`);
    }
    settings[key] = { value: values.project ?? values.user ?? spec.default, source: values.project !== null ? "project" : values.user !== null ? "user" : "default", ...values };
  }
  const testMode = process.env.PI_MCP_TEST === "1";
  const overrides = {};
  if (testMode) for (const [key, env, scale] of [["question_wait_minutes", "PI_MCP_ASK_TIMEOUT_MS", 60000], ["idle_park_minutes", "PI_MCP_TTL_MS", 60000], ["max_live_children", "PI_MCP_REGISTRY_CAP", 1]]) {
    const n = Number(process.env[env]);
    if (Number.isFinite(n) && n > 0 && (scale !== 1 || Number.isInteger(n))) {
      settings[key] = { ...settings[key], value: n / scale, source: "test-env" };
      overrides[env] = n;
    }
  }
  return { settings, projectPath, userPath, warnings, testMode, overrides };
}
export const resolveQuestionSettings = resolveSettings;
export function resolveTurnTimeout(cwd, explicit) {
  if (Number.isInteger(explicit) && explicit > 0) return { value: explicit, source: "call" };
  const setting = resolveSettings(cwd).settings.turn_timeout_minutes;
  return { value: setting.value === "unlimited" ? null : setting.value * 60000, source: setting.source };
}
export function settingsLabel(result) {
  return Object.entries(result.settings).map(([key, s]) => `${key} ${s.value} (${s.source})`).join(" · ") + (result.testMode ? " · test mode: env overrides active" : "") + (result.warnings.length ? ` · warnings: ${result.warnings.join("; ")}` : "");
}
// Patch only selected keys; preserve unrelated frontmatter, body and JSON fields.
export function writeSettings(cwd, scope, updates) {
  const configPath = scope === "user" ? userSettingsPath() : path.join(cwd, ".claude", "pi-delegate.local.md");
  const parsed = {};
  if (!["project", "user"].includes(scope)) return { ok: false, configPath, errorMessage: "scope must be project or user" };
  for (const [key, raw] of Object.entries(updates)) {
    parsed[key] = raw === "inherit" ? "inherit" : parseSetting(key, raw);
    if (parsed[key] === null || !Object.hasOwn(SETTINGS, key)) return { ok: false, configPath, errorMessage: `invalid ${key}: ${JSON.stringify(raw)}` };
  }
  try {
    let raw = "";
    try { raw = fs.readFileSync(configPath, "utf8"); } catch (err) { if (err.code !== "ENOENT") throw err; }
    let next;
    if (scope === "user") {
      const data = raw ? JSON.parse(raw) : {};
      if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("user config must be an object");
      for (const [key, value] of Object.entries(parsed)) {
        if (value === "inherit") delete data[key]; else data[key] = value;
      }
      next = JSON.stringify(data, null, 2) + "\n";
    } else {
      const fm = frontmatter(raw);
      if (raw.startsWith("---") && !fm) throw new Error("invalid project frontmatter");
      const lines = fm ? fm[1].split(/\r?\n/).filter(line => !Object.keys(parsed).some(key => new RegExp(`^${key}\\s*:`).test(line))) : [];
      for (const [key, value] of Object.entries(parsed)) if (value !== "inherit") lines.push(`${key}: ${value}`);
      next = `---\n${lines.join("\n")}\n---\n` + (fm ? raw.slice(fm[0].length) : raw);
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = `${configPath}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, next, { mode: 0o600 }); fs.renameSync(tmp, configPath); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    return { ok: true, configPath, settings: parsed, scope, errorMessage: null };
  } catch (err) { return { ok: false, configPath, errorMessage: err.message }; }
}
