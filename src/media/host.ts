/**
 * Puts a file on a public URL for networks that download media themselves (Instagram, Threads).
 * The Delivery runner removes every file once the Delivery is live or has failed.
 */
export type MediaHost = {
  put(filePath: string, mimeType: string): Promise<{ key: string; url: string }>;
  remove(key: string): Promise<void>;
};
