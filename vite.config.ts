import { defineConfig } from 'vite';

// Development must not serve local operational files, even when LAN access is
// deliberately enabled. Production serves only the built static directory.
export default defineConfig({
  // Preserve the Vite 7 browser floor through the Vite 8 bundler migration.
  build: { target: ['chrome107', 'edge107', 'firefox104', 'safari16'] },
  // Only a public commit identity is exposed; no environment object enters the bundle.
  define: {
    __LAST_SPIRE_BUILD__: JSON.stringify(
      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : 'development',
    ),
  },
  server: {
    host: '127.0.0.1',
    // Opt in only for a separately started loopback account API. No production proxy.
    proxy:
      process.env.LAST_SPIRE_API_PROXY === '1'
        ? { '/api': { target: 'http://127.0.0.1:8092', changeOrigin: false } }
        : undefined,
    fs: {
      strict: true,
      deny: [
        '**/.env',
        '**/.env.*',
        '**/*.{crt,pem,key,p12,pfx}',
        '**/id_rsa',
        '**/id_ed25519',
        '**/.git/**',
        '**/.private/**',
        '**/.account-build/**',
        '**/account-data/**',
        '**/server/**',
        '**/*.sqlite*',
        '**/.release/**',
        '**/.aws/**',
        '**/.codex/**',
        '**/.agents/**',
        '**/.serena/**',
        '**/checkpoints/**',
        '**/qa-data/**',
        '**/reports/**',
        '**/playlogs/**',
        '**/docs/plans/**',
        '**/docs/RESUME-v2.md',
        '**/docs/VALIDATION.md',
      ],
    },
  },
  preview: { host: '127.0.0.1' },
});
