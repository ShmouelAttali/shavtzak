/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_ALLOWED_EMAILS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
