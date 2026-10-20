/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'mock' | 'real'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_ASSISTANT_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
