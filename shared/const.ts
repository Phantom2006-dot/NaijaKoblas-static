export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
export const EMAIL_VERIFICATION_REQUIRED_MSG = "Verify your primary email address with Clerk before using your NaijaKoblas account.";

export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES_PER_REQUEST = 4;
export const MAX_PRODUCT_IMAGES_PER_LISTING = 10;
export const MAX_PRODUCT_UPLOAD_REQUEST_BYTES = MAX_PRODUCT_IMAGE_BYTES * MAX_PRODUCT_IMAGES_PER_REQUEST;
