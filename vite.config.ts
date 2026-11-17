import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages publica l'app a /INVALL/. Es pot canviar amb VITE_BASE (p. ex. "/" en un domini propi).
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', 'VITE_').VITE_BASE || '/INVALL/',
  plugins: [react()],
}));
