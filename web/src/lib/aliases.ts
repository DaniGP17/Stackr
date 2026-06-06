import { settings } from "./settings";

export function aliasKey(module: string, fn: string): string {
  return `${module}|${fn}`;
}

export function resolveAlias(
  aliases: Record<string, string>,
  module: string,
  fn: string,
): string {
  return aliases[aliasKey(module, fn)] ?? fn;
}

export function saveAlias(
  aliases: Record<string, string>,
  module: string,
  fn: string,
  name: string,
) {
  const next = { ...aliases };
  const key = aliasKey(module, fn);
  const trimmed = name.trim();
  if (trimmed && trimmed !== fn) {
    next[key] = trimmed;
  } else {
    delete next[key];
  }
  settings.set("functionAliases", next);
}

export function threadAliasKey(tid: number): string {
  return String(tid);
}

export function resolveThreadAlias(
  aliases: Record<string, string>,
  tid: number,
  nativeName: string,
): string {
  return aliases[threadAliasKey(tid)] ?? nativeName ?? "";
}

export function saveThreadAlias(
  aliases: Record<string, string>,
  tid: number,
  name: string,
) {
  const next = { ...aliases };
  const key = threadAliasKey(tid);
  if (name.trim()) {
    next[key] = name.trim();
  } else {
    delete next[key];
  }
  settings.set("threadAliases", next);
}
