// Runtime values are read at use time so Fly/Vercel secret updates take effect after restart.
export const ENV = {
  get clerkPublishableKey() { return process.env.CLERK_PUBLISHABLE_KEY ?? ""; },
  get clerkSecretKey() { return process.env.CLERK_SECRET_KEY ?? ""; },
  get ownerClerkUserId() { return process.env.OWNER_CLERK_USER_ID ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get databaseUrlUnpooled() { return process.env.DATABASE_URL_UNPOOLED ?? ""; },
  get paystackSecretKey() { return process.env.PAYSTACK_SECRET_KEY ?? ""; },
  get appBaseUrl() { return process.env.APP_BASE_URL ?? ""; },
  get cloudinaryCloudName() { return process.env.CLOUDINARY_CLOUD_NAME ?? ""; },
  get cloudinaryApiKey() { return process.env.CLOUDINARY_API_KEY ?? ""; },
  get cloudinaryApiSecret() { return process.env.CLOUDINARY_API_SECRET ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  // These service credentials are unrelated to user sign-in and still power optional Manus services.
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
};
