async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return { data };
}
export const api = {
  get: (path: string, options: RequestInit = {}) => request(path, options),
  post: (path: string, body: unknown) => request(path, { method: 'POST', body: JSON.stringify(body) }),
};
export const image = {
  async resizeIfNeeded(file: File) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an invoice image (JPEG, PNG, or WebP).');
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image under 20 MB.');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    return { data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1], mimeType: 'image/jpeg' };
  }
};
