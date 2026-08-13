/** Compress an image file to a JPEG data-URL suitable for profile storage. */
export async function fileToProfileDataUrl(
  file: File,
  { maxSize = 420, quality = 0.72 } = {},
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Image must be under 8MB');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (dataUrl.length > 850_000) {
    return canvas.toDataURL('image/jpeg', 0.55);
  }
  return dataUrl;
}
