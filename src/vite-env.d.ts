/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_ALLOWED_EMAILS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
