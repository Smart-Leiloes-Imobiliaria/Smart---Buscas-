export const config = {
  appName: "Imobiliária Smart Leilões",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/morada",
  freshnessHours: 12,
  defaultResultLimit: 50,
  deduplication: {
    automaticMatchMin: 90,
    manualReviewMin: 75,
  },
} as const;
