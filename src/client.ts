// Client API bridge replacing @appdeploy/client with standard fetch & browser APIs

export const api = {
    async get(url: string) {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
        }
        return { data };
    },
    async post(url: string, body: Record<string, any>) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
        }
        return { data };
    }
};

export const image = {
    async resizeIfNeeded(file: File): Promise<{ data: string; mimeType: string }> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read image file'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Failed to parse image'));
                img.onload = () => {
                    const maxDim = 1600;
                    let { width, height } = img;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        } else {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        return reject(new Error('Canvas 2D context unavailable'));
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    const mimeType = file.type || 'image/jpeg';
                    const dataUrl = canvas.toDataURL(mimeType, 0.85);
                    const base64 = dataUrl.split(',')[1] || '';
                    resolve({ data: base64, mimeType });
                };
                img.src = reader.result as string;
            };
            reader.readAsDataURL(file);
        });
    }
};
