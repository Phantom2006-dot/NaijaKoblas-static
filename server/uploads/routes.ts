import { v2 as cloudinary } from "cloudinary";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import {
  canUploadProductImages,
  detectProductImageFormat,
  isProductImageBatchWithinLimits,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES_PER_REQUEST,
  MAX_PRODUCT_UPLOAD_REQUEST_BYTES,
} from "../commerce/product-upload";
import { resolveClerkUser } from "../_core/context";
import { ENV } from "../_core/env";
import * as db from "../db";
import { createUploadConcurrencyGate } from "./concurrency";

type UploadTarget = NonNullable<Awaited<ReturnType<typeof db.getProductUploadTarget>>>;
type AuthenticatedUploadRequest = Request & { appUser?: User; uploadTarget?: UploadTarget; releaseUploadSlot?: () => void };
type UploadRateWindow = { startedAt: number; requestCount: number };

const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_ACTIVE_PRODUCT_UPLOADS = 1;
const MAX_UPLOAD_REQUESTS_PER_USER = 12;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_UPLOAD_USERS = 10_000;
const MAX_MULTIPART_OVERHEAD_BYTES = 128 * 1024;
const uploadConcurrencyGate = createUploadConcurrencyGate(MAX_ACTIVE_PRODUCT_UPLOADS);
const uploadRateWindows = new Map<number, UploadRateWindow>();

// Memory storage is bounded to 4 × 8 MB and one active batch per Node process.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PRODUCT_IMAGE_BYTES,
    files: MAX_PRODUCT_IMAGES_PER_REQUEST,
    fields: 0,
    parts: MAX_PRODUCT_IMAGES_PER_REQUEST,
    fieldNameSize: 64,
    fieldSize: 1024,
    headerPairs: 64,
  },
  fileFilter(_req, file, callback) {
    if (!acceptedMimeTypes.has(file.mimetype.toLowerCase())) {
      callback(new Error("Only JPEG, PNG and WebP product photos are accepted."));
      return;
    }
    callback(null, true);
  },
});

async function requireVerifiedMarketplaceUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveClerkUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in with a verified email to upload product images." });
      return;
    }
    (req as AuthenticatedUploadRequest).appUser = user;
    next();
  } catch (error) {
    if (error instanceof TRPCError) {
      res.status(error.code === "PRECONDITION_FAILED" ? 412 : 401).json({ error: error.message });
      return;
    }
    res.status(503).json({ error: "Account verification is temporarily unavailable." });
  }
}

function validateProductId(req: Request, res: Response, next: NextFunction) {
  const productId = String(req.params.productId ?? "");
  if (!/^prod_[a-f0-9]{32}$/i.test(productId)) {
    res.status(400).json({ error: "Invalid product listing." });
    return;
  }
  next();
}

async function loadAndAuthorizeUploadTarget(req: Request, res: Response, next: NextFunction) {
  const uploadReq = req as AuthenticatedUploadRequest;
  const user = uploadReq.appUser;
  if (!user) {
    res.status(401).json({ error: "Sign in to upload product images." });
    return;
  }
  try {
    const target = await db.getProductUploadTarget(String(req.params.productId));
    if (!target) {
      res.status(404).json({ error: "Product listing not found." });
      return;
    }
    const allowed = canUploadProductImages({
      actor: { id: user.id, role: user.role },
      seller: {
        userId: target.product.sellerUserId,
        role: target.sellerRole,
        applicationStatus: target.applicationStatus,
        storeActive: target.storeActive ?? false,
      },
    });
    if (!allowed) {
      res.status(403).json({ error: "You do not have permission to upload images for this seller listing." });
      return;
    }
    uploadReq.uploadTarget = target;
    next();
  } catch {
    console.warn("[Uploads] Product access lookup failed.");
    res.status(503).json({ error: "Product upload authorization is temporarily unavailable." });
  }
}

function requireCloudinaryStorage(_req: Request, res: Response, next: NextFunction) {
  if (!(ENV.cloudinaryCloudName && ENV.cloudinaryApiKey && ENV.cloudinaryApiSecret)) {
    res.status(503).json({ error: "Durable product image storage is not configured yet." });
    return;
  }
  next();
}

function rateLimitProductUploads(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedUploadRequest).appUser;
  if (!user) {
    res.status(401).json({ error: "Sign in to upload product images." });
    return;
  }

  const now = Date.now();
  let window = uploadRateWindows.get(user.id);
  if (!window || now - window.startedAt >= UPLOAD_RATE_WINDOW_MS) {
    if (uploadRateWindows.size >= MAX_TRACKED_UPLOAD_USERS) {
      for (const [userId, entry] of uploadRateWindows) {
        if (now - entry.startedAt >= UPLOAD_RATE_WINDOW_MS) uploadRateWindows.delete(userId);
      }
    }
    if (uploadRateWindows.size >= MAX_TRACKED_UPLOAD_USERS && !window) {
      res.status(429).json({ error: "Image upload capacity is temporarily limited. Try again later." });
      return;
    }
    window = { startedAt: now, requestCount: 0 };
    uploadRateWindows.set(user.id, window);
  }
  if (window.requestCount >= MAX_UPLOAD_REQUESTS_PER_USER) {
    const retryAfter = Math.max(1, Math.ceil((window.startedAt + UPLOAD_RATE_WINDOW_MS - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Upload limit reached. Please try again later." });
    return;
  }
  window.requestCount += 1;
  next();
}

function limitConcurrentProductUploads(req: Request, res: Response, next: NextFunction) {
  const release = uploadConcurrencyGate.acquire();
  if (!release) {
    res.setHeader("Retry-After", "5");
    res.status(429).json({ error: "Another photo upload is in progress. Please retry in a moment." });
    return;
  }

  (req as AuthenticatedUploadRequest).releaseUploadSlot = release;
  next();
}

function releaseProductUploadSlot(req: Request) {
  const uploadReq = req as AuthenticatedUploadRequest;
  uploadReq.releaseUploadSlot?.();
  uploadReq.releaseUploadSlot = undefined;
}

function rejectOversizedMultipartRequest(req: Request, res: Response, next: NextFunction) {
  const contentLength = req.get("content-length");
  const bytes = contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : 0;
  if (bytes > MAX_PRODUCT_UPLOAD_REQUEST_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
    res.status(413).json({ error: "Upload up to four photos per batch, with a 32 MB combined file limit." });
    return;
  }
  next();
}

const parseProductImages: RequestHandler = (req, res, next) => {
  imageUpload.array("images", MAX_PRODUCT_IMAGES_PER_REQUEST)(req, res, error => {
    if (!error) {
      next();
      return;
    }
    releaseProductUploadSlot(req);
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: error.code === "LIMIT_FILE_SIZE"
        ? "Each image must be 8 MB or smaller."
        : "Upload up to four photos per batch using the images field." });
      return;
    }
    res.status(400).json({ error: "Only JPEG, PNG and WebP product photos are accepted." });
  });
};

async function destroyWithRetry(publicId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
      if (response.result === "ok" || response.result === "not found") return true;
    } catch {
      // Retry transient provider errors without logging asset identifiers or response bodies.
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
  }
  return false;
}

async function removeCloudinaryImages(publicIds: string[]) {
  const results = await Promise.all(publicIds.map(destroyWithRetry));
  const failedCount = results.filter(success => !success).length;
  if (failedCount > 0) console.error(`[Uploads] Cloudinary cleanup failed for ${failedCount} asset(s); manual review may be required.`);
}

async function storeCloudinaryImage(buffer: Buffer, productId: string) {
  return new Promise<{
    secure_url?: string;
    public_id?: string;
    asset_id?: string;
    width?: number;
    height?: number;
  }>((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream({
      resource_type: "image",
      folder: `naijakoblas/products/${productId}`,
      unique_filename: true,
      use_filename: false,
      overwrite: false,
      allowed_formats: ["jpg", "png", "webp"],
    }, (error, result) => {
      if (error || !result) {
        reject(error ?? new Error("Cloudinary returned no image result."));
        return;
      }
      resolve(result);
    });
    Readable.from([buffer]).pipe(upload);
  });
}

export function registerProductUploadRoutes(app: Express) {
  app.post(
    "/api/uploads/products/:productId/images",
    requireVerifiedMarketplaceUser,
    validateProductId,
    loadAndAuthorizeUploadTarget,
    requireCloudinaryStorage,
    rateLimitProductUploads,
    rejectOversizedMultipartRequest,
    limitConcurrentProductUploads,
    parseProductImages,
    async (req: Request, res: Response) => {
      const uploadReq = req as AuthenticatedUploadRequest;
      const user = uploadReq.appUser;
      const target = uploadReq.uploadTarget;
      const productId = String(req.params.productId);
      const files = (req as Request & { files?: Express.Multer.File[] }).files ?? [];
      const uploaded: Array<{ publicId: string; image: db.NewProductImage }> = [];

      try {
        if (!user || !target) {
          res.status(401).json({ error: "Sign in to upload product images." });
          return;
        }
        if (!isProductImageBatchWithinLimits(files.map(file => file.size))) {
          res.status(413).json({ error: "Upload one to four photos per batch; each must be 8 MB or smaller and the combined limit is 32 MB." });
          return;
        }
        const formats = files.map(file => detectProductImageFormat(file.mimetype, file.buffer));
        if (formats.some(format => format === null)) {
          res.status(400).json({ error: "Image content did not match an accepted JPEG, PNG or WebP file." });
          return;
        }

        cloudinary.config({
          cloud_name: ENV.cloudinaryCloudName,
          api_key: ENV.cloudinaryApiKey,
          api_secret: ENV.cloudinaryApiSecret,
          secure: true,
        });

        for (const [index, file] of files.entries()) {
          const result = await storeCloudinaryImage(file.buffer, productId);
          const publicId = result.public_id;
          const secureUrl = result.secure_url;
          if (!publicId || !secureUrl || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height)) {
            if (publicId) uploaded.push({ publicId, image: { url: secureUrl ?? "", publicId, assetId: result.asset_id ?? null, width: 1, height: 1, format: formats[index]! } });
            throw new Error("Cloudinary image metadata was incomplete.");
          }
          const url = new URL(secureUrl);
          if (url.protocol !== "https:" || !(url.hostname === "res.cloudinary.com" || url.hostname.endsWith(".cloudinary.com"))) {
            uploaded.push({ publicId, image: { url: secureUrl, publicId, assetId: result.asset_id ?? null, width: result.width!, height: result.height!, format: formats[index]! } });
            throw new Error("Cloudinary returned an untrusted asset URL.");
          }
          uploaded.push({
            publicId,
            image: {
              url: secureUrl,
              publicId,
              assetId: result.asset_id ?? null,
              width: result.width!,
              height: result.height!,
              format: formats[index]!,
            },
          });
        }

        const images = await db.addSellerProductImages({
          actorUserId: user.id,
          sellerUserId: target.product.sellerUserId,
          productId,
          images: uploaded.map(item => item.image),
        });
        res.status(201).json({ images });
      } catch (error) {
        await removeCloudinaryImages(uploaded.map(item => item.publicId));
        if (error instanceof db.CommerceValidationError) {
          res.status(400).json({ error: error.message });
          return;
        }
        console.warn("[Uploads] Product image persistence or provider operation failed.");
        res.status(502).json({ error: "Product images could not be stored. Please try again." });
      } finally {
        releaseProductUploadSlot(req);
      }
    },
  );
}
