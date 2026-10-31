import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root:__dirname,
  plugins:[react()],
  define:{__APP_VERSION__:JSON.stringify('9.2.3-web')},
  build:{outDir:path.resolve(__dirname,'../../dist-web/public'),emptyOutDir:true,sourcemap:false},
});
