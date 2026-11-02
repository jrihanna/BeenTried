// Loads .env into process.env. Import this first in every entry point.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; rely on the real environment.
}
