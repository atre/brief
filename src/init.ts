import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOOK_COMMAND = 'command -v brief >/dev/null 2>&1 || exit 0; brief . --tokens 800';

/** Merge a SessionStart hook running `brief .` into a .claude/settings.json body. Idempotent. */
export function mergeSessionHook(settingsText: string | undefined): { text: string; changed: boolean } {
  const settings = settingsText?.trim() ? (JSON.parse(settingsText) as Record<string, unknown>) : {};
  const hooks = (settings.hooks ??= {}) as Record<string, unknown>;
  const start = (hooks.SessionStart ??= []) as Array<{ hooks?: Array<{ type?: string; command?: string; timeout?: number }> }>;
  const present = start.some((m) => m.hooks?.some((h) => typeof h.command === 'string' && /\bbrief\b/.test(h.command)));
  if (!present) start.push({ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 20 }] });
  return { text: `${JSON.stringify(settings, null, 2)}\n`, changed: !present };
}

export function cmdInit(dir: string): number {
  const settingsPath = join(dir, '.claude', 'settings.json');
  const prev = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : undefined;
  let merged: { text: string; changed: boolean };
  try {
    merged = mergeSessionHook(prev);
  } catch {
    console.error(`brief: ${settingsPath} is not valid JSON — hook not added`);
    return 1;
  }
  if (!merged.changed) {
    console.log(`brief: SessionStart hook already wired in ${settingsPath}`);
    return 0;
  }
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(settingsPath, merged.text);
  console.log(`wired SessionStart hook (brief . --tokens 800) into ${settingsPath}`);
  return 0;
}
