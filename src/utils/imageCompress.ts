/**
 * Fast client-side image compression before uploading clothing items or portraits.
 * Produces compact JPEGs for minimal Gemini vision tokens and cloud Firestore sync.
 */
export async function compressClothingImage(file: File, maxDim = 1024): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 220_000) {
    return file;
  }

  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.fillStyle = '#F5F5F7';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, '');
          resolve(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.82
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/**
 * Compresses an image file to a crisp JPEG data URL guaranteed under maxChars
 * so every garment and portrait syncs rapidly in Firestore across all devices.
 */
export async function compressImageToDataUrl(
  file: File,
  maxDim = 640,
  maxChars = 190_000
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const dimensions = [maxDim, 520, 400];
      const qualities = [0.78, 0.66, 0.54, 0.42];

      let bestDataUrl = '';
      for (const dim of dimensions) {
        const scale = Math.min(1, dim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Unable to process image in browser.'));
          return;
        }
        ctx.fillStyle = '#F5F5F7';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        for (const q of qualities) {
          const candidate = canvas.toDataURL('image/jpeg', q);
          bestDataUrl = candidate;
          if (candidate.length <= maxChars) {
            const base64 = candidate.slice('data:image/jpeg;base64,'.length);
            resolve({ dataUrl: candidate, base64, mimeType: 'image/jpeg' });
            return;
          }
        }
      }

      if (bestDataUrl.length <= 245_000) {
        const base64 = bestDataUrl.slice('data:image/jpeg;base64,'.length);
        resolve({ dataUrl: bestDataUrl, base64, mimeType: 'image/jpeg' });
        return;
      }
      reject(new Error('Image is too large even after compression. Try a smaller photo.'));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode image file.'));
    };

    img.src = objectUrl;
  });
}
