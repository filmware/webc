import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), react(), svgr()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/'),
    },
  },
})
