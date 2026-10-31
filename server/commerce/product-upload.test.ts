import { describe, expect, it } from "vitest";
import { canUploadProductImages, detectProductImageFormat, hasPrimaryProductImage, isProductImageBatchWithinLimits, MAX_PRODUCT_IMAGE_BYTES, MAX_PRODUCT_IMAGES_PER_REQUEST } from "./product-upload";

const sellerTarget = { userId: 10, role: "seller" as const, applicationStatus: "approved" as const, storeActive: true };

describe("product upload security", () => {
  it("requires matching JPEG, PNG or full RIFF/WEBP signatures", () => {
    expect(detectProductImageFormat("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("jpg");
    expect(detectProductImageFormat("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(detectProductImageFormat("image/webp", Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]))).toBe("webp");
    expect(detectProductImageFormat("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(null);
    expect(detectProductImageFormat("image/jpeg", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(null);
    expect(detectProductImageFormat("image/svg+xml", Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))).toBe(null);
  });

  it("bounds each memory-backed batch to four files and 32 MB total", () => {
    expect(isProductImageBatchWithinLimits(Array(MAX_PRODUCT_IMAGES_PER_REQUEST).fill(MAX_PRODUCT_IMAGE_BYTES))).toBe(true);
    expect(isProductImageBatchWithinLimits(Array(MAX_PRODUCT_IMAGES_PER_REQUEST + 1).fill(1))).toBe(false);
    expect(isProductImageBatchWithinLimits([MAX_PRODUCT_IMAGE_BYTES + 1])).toBe(false);
    expect(isProductImageBatchWithinLimits([0])).toBe(false);
    expect(isProductImageBatchWithinLimits([])).toBe(false);
  });

  it("requires a primary gallery image before publication", () => {
    expect(hasPrimaryProductImage([])).toBe(false);
    expect(hasPrimaryProductImage([{ isPrimary: false }])).toBe(false);
    expect(hasPrimaryProductImage([{ isPrimary: false }, { isPrimary: true }])).toBe(true);
  });

  it("allows a seller only to upload to their own approved active store", () => {
    expect(canUploadProductImages({ actor: { id: 10, role: "seller" }, seller: sellerTarget })).toBe(true);
    expect(canUploadProductImages({ actor: { id: 11, role: "seller" }, seller: sellerTarget })).toBe(false);
    expect(canUploadProductImages({ actor: { id: 10, role: "seller" }, seller: { ...sellerTarget, storeActive: false } })).toBe(false);
    expect(canUploadProductImages({ actor: { id: 10, role: "seller" }, seller: { ...sellerTarget, applicationStatus: "suspended" } })).toBe(false);
  });

  it("allows staff and administrators to upload only for approved active sellers", () => {
    expect(canUploadProductImages({ actor: { id: 30, role: "staff" }, seller: sellerTarget })).toBe(true);
    expect(canUploadProductImages({ actor: { id: 31, role: "admin" }, seller: sellerTarget })).toBe(true);
    expect(canUploadProductImages({ actor: { id: 30, role: "staff" }, seller: { ...sellerTarget, storeActive: false } })).toBe(false);
    expect(canUploadProductImages({ actor: { id: 20, role: "customer" }, seller: sellerTarget })).toBe(false);
  });
});
