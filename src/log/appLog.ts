import fs from 'fs';
import path from 'path';
import type { ApplicationEntry, ApplicationStatus } from '../types.js';

const LOG_PATH = path.resolve('data/applications.json');

export function loadLog(): ApplicationEntry[] {
  if (!fs.existsSync(LOG_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(LOG_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as ApplicationEntry[];
  } catch {
    return [];
  }
}

export function logApplication(entry: ApplicationEntry): void {
  const entries = loadLog();
  entries.push(entry);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2), 'utf-8');
}

export function updateEntry(id: string, updates: { status: ApplicationStatus }): boolean {
  const entries = loadLog();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries[idx] = { ...entries[idx], ...updates };
  fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  return true;
}
