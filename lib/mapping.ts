import * as fs from 'fs';
import * as path from 'path';

interface MappingRule {
  source?: string;
  sourcePattern?: string;
  medium: string[];
  crmSource?: string | null;
  skip?: boolean;
  note?: string;
}

interface MappingConfig {
  rules: MappingRule[];
}

let cached: MappingConfig | null = null;

function loadConfig(): MappingConfig {
  if (!cached) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'config', 'mapping.json'), 'utf-8');
    cached = JSON.parse(raw);
  }
  return cached!;
}

export type MappingResult =
  | { kind: 'skip'; note: string }
  | { kind: 'map'; crmSource: string }
  | { kind: 'unmapped'; note: string }
  | { kind: 'no_rule' };

/** Resolves a WhatConverts lead_source/lead_medium pair to the ServiceAssistant
 * Source dropdown label, per config/mapping.json. Matching is case-insensitive. */
export function resolveCrmSource(leadSource: string, leadMedium: string): MappingResult {
  const { rules } = loadConfig();
  const src = (leadSource || '').trim().toLowerCase();
  const med = (leadMedium || '').trim().toLowerCase();

  for (const rule of rules) {
    const sourceMatches = rule.sourcePattern
      ? new RegExp(rule.sourcePattern, 'i').test(src)
      : rule.source?.toLowerCase() === src;
    if (!sourceMatches) continue;

    const mediumMatches = rule.medium.includes('*') || rule.medium.some((m) => m.toLowerCase() === med);
    if (!mediumMatches) continue;

    if (rule.skip) return { kind: 'skip', note: rule.note ?? 'Marked skip in mapping.json' };
    if (rule.crmSource === null) return { kind: 'unmapped', note: rule.note ?? 'No CRM source mapped' };
    return { kind: 'map', crmSource: rule.crmSource! };
  }

  return { kind: 'no_rule' };
}
