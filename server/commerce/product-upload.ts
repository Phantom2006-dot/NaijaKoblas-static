import type { AccountRole, SellerApplicationStatus } from "../../drizzle/schema";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES_PER_LISTING,
  MAX_PRODUCT_IMAGES_PER_REQUEST,
  MAX_PRODUCT_UPLOAD_REQUEST_BYTES,
} from "@shared/const";

export {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES_PER_LISTING,
  MAX_PRODUCT_IMAGES_PER_REQUEST,
  MAX_PRODUCT_UPLOAD_REQUEST_BYTES,
} from "@shared/const";

export type SupportedProductImageFormat = "jpg" | "png" | "webp";

const MIME_FORMATS: Record<string, SupportedProductImageFormat> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function detectProductImageFormat(mimeType: string, bytes: Uint8Array): SupportedProductImageFormat | null {
  const expected = MIME_FORMATS[mimeType.toLowerCase()];
  if (!expected) return null;

  let detected: SupportedProductImageFormat | null = null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) detected = "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) detected = "png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") detected = "webp";

  return detected === expected ? detected : null;
}

export function isProductImageBatchWithinLimits(fileSizes: number[]): boolean {
  return fileSizes.length > 0
    && fileSizes.length <= MAX_PRODUCT_IMAGES_PER_REQUEST
    && fileSizes.every(size => Number.isSafeInteger(size) && size > 0 && size <= MAX_PRODUCT_IMAGE_BYTES)
    && fileSizes.reduce((total, size) => total + size, 0) <= MAX_PRODUCT_UPLOAD_REQUEST_BYTES;
}

export function hasPrimaryProductImage(images: readonly { isPrimary: boolean }[]): boolean {
  return images.some(image => image.isPrimary);
}

export function canUploadProductImages(input: {
  actor: { id: number; role: AccountRole };
  seller: { userId: number; role: AccountRole; applicationStatus: SellerApplicationStatus | null; storeActive: boolean };
}): boolean {
  const { actor, seller } = input;
  if (seller.role !== "seller" || seller.applicationStatus !== "approved" || !seller.storeActive) return false;
  if (actor.role === "seller") return actor.id === seller.userId;
  return actor.role === "staff" || actor.role === "admin";
}
