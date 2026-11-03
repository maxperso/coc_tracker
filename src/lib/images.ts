import { IMAGE_BYTES_MAX, type ImageType, type NewImage } from "./backlog";

/** Capture prête à l'envoi, avec son aperçu (URL « data: », seule forme d'image locale permise par la CSP). */
export interface PickedImage extends NewImage {
  preview: string;
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error("Image illisible."));
    img.src = src;
  });

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, quality));

/** Vise moins que la limite du serveur : l'envoi reste rapide sur mobile. */
const TARGET_BYTES = Math.min(IMAGE_BYTES_MAX, 900_000);

/**
 * Réduit une capture dans le navigateur : 1600 px au plus sur le grand côté, réencodée en WebP (JPEG si le
 * navigateur ne sait pas). Le réencodage retire aussi les métadonnées des photos (position GPS, appareil).
 */
export async function compressImage(file: Blob): Promise<PickedImage> {
  const img = await loadImage(await readAsDataUrl(file));
  const canvas = document.createElement("canvas");
  let side = 1600;
  let quality = 0.85;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob) break;
    if (blob.size <= TARGET_BYTES || attempt === 5) {
      if (blob.size > IMAGE_BYTES_MAX) break;
      const preview = await readAsDataUrl(blob);
      return { type: blob.type as ImageType, data: preview.slice(preview.indexOf(",") + 1), preview };
    }
    side = Math.round(side * 0.8);
    quality = Math.max(0.6, quality - 0.08);
  }
  throw new Error("Cette image est trop lourde, même réduite.");
}
