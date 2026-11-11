"use server";

import { field, runFormAction } from "@/app/form-action";
import { getDb } from "@/db/client";
import { deleteAsset } from "@/media/library";

export async function deleteAssetAction(formData: FormData) {
  await runFormAction("/media", async () => {
    await deleteAsset(getDb(), field(formData, "id"));
    return "File deleted.";
  });
}
