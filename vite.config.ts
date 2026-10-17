import { defineConfig } from 'vite';

// Development must not serve local operational files, even when LAN access is
// deliberately enabled. Production serves only the built static directory.
export default defineConfig({
  server: {
    host: '127.0.0.1',
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
