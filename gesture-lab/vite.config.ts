import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }).trim()
  } catch { return 'unavailable' }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __GESTURE_BUILD__: JSON.stringify({
      branch: git('branch', '--show-current'),
      commit: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain') !== '',
      builtAt: new Date().toISOString(),
    }),
  },
})
