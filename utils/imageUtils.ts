import { type Crop } from 'react-image-crop';

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export function getImageDimensions(src: string): Promise<{ naturalWidth: number, naturalHeight: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        img.onerror = (error) => reject(error);
        img.src = src;
    });
}

export async function createCroppedBlob(
  image: HTMLImageElement,
  crop?: Crop,
  outputWidth: number = 1080,
  adjustments?: { brightness: number; contrast: number; saturate: number; hue: number; }
): Promise<Blob> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    
    if (adjustments) {
      ctx.filter = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturate}%) hue-rotate(${adjustments.hue}deg)`;
    }

    // If no crop is provided, use the whole image
    if (!crop || !crop.width || !crop.height) {
        const scale = outputWidth / image.naturalWidth;
        canvas.width = outputWidth;
        canvas.height = image.naturalHeight * scale;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    } else {
        // Crop is in percentages (0-100). Convert to pixels.
        const cropX = (crop.x / 100) * image.naturalWidth;
        const cropY = (crop.y / 100) * image.naturalHeight;
        const cropWidth = (crop.width / 100) * image.naturalWidth;
        const cropHeight = (crop.height / 100) * image.naturalHeight;

        // Calculate output dimensions while maintaining aspect ratio of the crop
        const scale = outputWidth / cropWidth;
        const outputHeight = cropHeight * scale;

        canvas.width = outputWidth;
        canvas.height = outputHeight;

        ctx.drawImage(
            image,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            0,
            0,
            canvas.width,
            canvas.height
        );
    }
  
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('Canvas is empty'));
          return;
        }
        resolve(blob);
      }, 'image/png', 0.95);
    });
}

export async function base64ToBlob(base64: string, mimeType: string): Promise<Blob> {
  const response = await fetch(base64);
  const blob = await response.blob();
  return blob;
}
