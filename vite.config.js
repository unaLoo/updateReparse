import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    basicSsl({
      /** name of certification */
      name: 'test',
      /** custom trust domains */
      domains: ['*.custom.com'],
      /** custom certification directory */
      certDir: '/Users/.../.devServer/cert'
    })
  ],
  server: {
    host: '0.0.0.0',
  }
})
