/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional comma-separated list of parent origins an embed may honour in
   * its `parentOrigin` URL parameter (embed/origins.ts). Unset = any exact
   * http(s) origin the embed URL names.
   */
  readonly VITE_HOLODECK_EMBED_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
