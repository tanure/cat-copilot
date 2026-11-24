const prefix = 'catpilot-asset:';

function safeParts(parts: string[]): boolean {
  return parts.every(part => !!part && part !== '.' && part !== '..' &&
    !/[\\/:<>"|?*\x00-\x1f]/.test(part) && !/[ .]$/.test(part) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

export function assetPath(reference: string): string | null {
  if (!reference.startsWith(prefix)) return null;
  const relative = reference.slice(prefix.length);
  if (/[\s?#\\]/.test(relative)) return null;
  try {
    const parts = relative.split('/').map(part => decodeURIComponent(part));
    return safeParts(parts) ? parts.join('/') : null;
  } catch { return null; }
}

export function importedAssetReference(reference: string): string | null {
  if (!reference.startsWith(prefix)) return null;
  // The native importer returns the actual portable filesystem name, not a URI-encoded path.
  const parts = reference.slice(prefix.length).split('/');
  if (!safeParts(parts)) return null;
  return prefix + parts.map(part => encodeURIComponent(part).replace(/[!'()*]/g, value =>
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

export function imageMime(mime: string): boolean {
  return /^image\/(?:png|jpeg|gif|webp)$/i.test(mime);
}

export function imagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}
