/** Raw responses kept per file version, so an unchanged file costs no API calls. */
export interface DesignCache {
  get(fileKey: string, version: string, name: string): unknown;
  put(fileKey: string, version: string, name: string, value: unknown): void;
}
