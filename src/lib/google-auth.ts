import { GoogleAuth, type GoogleAuthOptions } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function googleCloudAuth(options: GoogleAuthOptions = {}) {
  return new GoogleAuth({
    ...googleCredentialsOptions(),
    scopes: options.scopes ?? [CLOUD_PLATFORM_SCOPE],
    ...options,
  });
}

function googleCredentialsOptions(): GoogleAuthOptions {
  const rawCredentials = process.env.GOOGLE_CREDENTIALS_JSON?.trim();
  if (!rawCredentials) return {};

  try {
    return { credentials: JSON.parse(rawCredentials) as GoogleAuthOptions["credentials"] };
  } catch (error) {
    throw new Error("GOOGLE_CREDENTIALS_JSON deve conter um JSON válido de service account.", {
      cause: error,
    });
  }
}
