import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { MAX_PRODUCT_IMAGE_BYTES, MAX_PRODUCT_IMAGES_PER_LISTING, MAX_PRODUCT_IMAGES_PER_REQUEST, MAX_PRODUCT_UPLOAD_REQUEST_BYTES } from "@shared/const";
import { useAuthRuntime } from "@/_core/auth-runtime";
import { trpc } from "@/lib/trpc";

export type ProductGalleryImage = {
  id: number;
  url: string;
  caption: string | null;
  displayOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  format: string;
};

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProductImageUploader({
  productId,
  initialImages,
  canSetPrimary = false,
  onUploaded,
}: {
  productId: string;
  initialImages: ProductGalleryImage[];
  canSetPrimary?: boolean;
  onUploaded?: () => void;
}) {
  const runtime = useAuthRuntime();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(initialImages);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setImages(current => {
    const unchanged = current.length === initialImages.length && current.every((image, index) => {
      const next = initialImages[index];
      return next && image.id === next.id && image.url === next.url && image.isPrimary === next.isPrimary
        && image.displayOrder === next.displayOrder && image.format === next.format && image.caption === next.caption;
    });
    return unchanged ? current : initialImages;
  }), [initialImages]);
  const setPrimary = trpc.seller.setPrimaryImage.useMutation({
    onSuccess: image => {
      setImages(current => current.map(item => ({ ...item, isPrimary: item.id === image.id })));
      setMessage("Primary product photo updated.");
      onUploaded?.();
    },
  });

  const chooseFiles = (selected: FileList | null) => {
    setError(null);
    setMessage(null);
    const next = Array.from(selected ?? []);
    const remaining = Math.max(0, MAX_PRODUCT_IMAGES_PER_LISTING - images.length);
    if (next.length > remaining || next.length > MAX_PRODUCT_IMAGES_PER_REQUEST) {
      setFiles([]);
      setError(`Select at most ${Math.min(remaining, MAX_PRODUCT_IMAGES_PER_REQUEST)} photo${Math.min(remaining, MAX_PRODUCT_IMAGES_PER_REQUEST) === 1 ? "" : "s"} for this batch; a listing can have up to ${MAX_PRODUCT_IMAGES_PER_LISTING}.`);
      return;
    }
    const invalid = next.find(file => !ACCEPTED_TYPES.has(file.type) || file.size > MAX_PRODUCT_IMAGE_BYTES);
    if (invalid) {
      setFiles([]);
      setError("Choose JPEG, PNG or WebP photos, 8 MB or smaller each.");
      return;
    }
    if (next.reduce((total, file) => total + file.size, 0) > MAX_PRODUCT_UPLOAD_REQUEST_BYTES) {
      setFiles([]);
      setError("The combined photo size must not exceed 32 MB per upload batch.");
      return;
    }
    setFiles(next);
  };

  const upload = async () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const token = await runtime.getToken?.();
      if (!token) throw new Error("Your secure session is not ready. Sign in again and retry.");
      const body = new FormData();
      files.forEach(file => body.append("images", file));
      const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
      const response = await fetch(`${apiBase}/api/uploads/products/${encodeURIComponent(productId)}/images`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        body,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Product photos could not be uploaded.";
        throw new Error(detail);
      }
      if (!payload || typeof payload !== "object" || !("images" in payload) || !Array.isArray(payload.images)) {
        throw new Error("The upload completed without a valid image response. Refresh the listing before retrying.");
      }
      const returned = payload.images as ProductGalleryImage[];
      setImages(current => [...current, ...returned].sort((a, b) => a.displayOrder - b.displayOrder));
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      setMessage(`${returned.length} product photo${returned.length === 1 ? "" : "s"} uploaded securely.`);
      onUploaded?.();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Product photos could not be uploaded.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="product-image-uploader">
    {images.length > 0 && <div className="product-image-gallery" aria-label="Product photo gallery">
      {images.map(image => <figure key={image.id} className={image.isPrimary ? "is-primary" : ""}>
        <img src={image.url} alt={image.caption ?? "Product photo"} loading="lazy" />
        <figcaption>{image.isPrimary ? "Primary photo" : image.format.toUpperCase()}</figcaption>
        {canSetPrimary && !image.isPrimary && <button type="button" className="text-button" disabled={setPrimary.isPending} onClick={() => setPrimary.mutate({ productId, imageId: image.id })}>Make primary</button>}
      </figure>)}
    </div>}
    {images.length < MAX_PRODUCT_IMAGES_PER_LISTING && <div className="product-upload-controls">
      <label className="form-field"><span>ADD PRODUCT PHOTOS (JPEG, PNG OR WEBP · 8 MB EACH · 4 PHOTOS / 32 MB PER BATCH)</span><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => chooseFiles(event.target.files)} /></label>
      {files.length > 0 && <p className="product-upload-selection"><ImagePlus size={15} /> {files.length} selected · {(files.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024)).toFixed(1)} MB</p>}
      <button type="button" className="button button--outline" onClick={() => void upload()} disabled={busy || files.length === 0 || runtime.status !== "ready"}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{busy ? "Uploading…" : "Upload photos"}
      </button>
    </div>}
    {message && <p className="form-success"><Check size={15} />{message}</p>}
    {(error || setPrimary.error) && <p className="portal-error" role="alert">{error ?? setPrimary.error?.message}</p>}
  </div>;
}
