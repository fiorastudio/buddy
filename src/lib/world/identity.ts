// src/lib/world/identity.ts
// Public identity for citizens: url slugs and name hygiene.

import { randomBytes } from 'node:crypto';

function defaultSuffix(): string {
  return randomBytes(3).toString('hex').slice(0, 4);
}

export function makeSlug(name: string, suffix: () => string = defaultSuffix): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'buddy'}-${suffix()}`;
}

// Deliberately small: block the words nobody wants floating over a plaza,
// not a linguistics project. Leet substitutions collapsed before matching.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'bitch', 'asshole'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

export function isNameClean(name: string): boolean {
  const collapsed = name
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
  return !BLOCKED.some((word) => collapsed.includes(word));
}
