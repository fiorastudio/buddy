const MAX_NAME_LENGTH = 40;

export function sanitizeName(name: string | undefined): string {
  if (!name) return '';
  return name
    .replace(/[\p{Cf}\p{Cc}\p{Co}]/gu, '')  // strip unicode format/control/private-use chars
    .replace(/[{}$`\\]/g, '')                 // strip template/injection chars
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}
