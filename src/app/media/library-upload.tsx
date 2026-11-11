"use client";

import { useRouter } from "next/navigation";
import { MediaDropzone } from "@/ui/media-dropzone";

export function LibraryUpload() {
  const router = useRouter();
  return <MediaDropzone onUploaded={() => router.refresh()} />;
}
