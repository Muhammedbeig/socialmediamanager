"use server";

import { field, runFormAction } from "@/app/form-action";
import { createBrand, deleteBrand, renameBrand } from "@/brands/service";
import { getDb } from "@/db/client";

export async function createBrandAction(formData: FormData) {
  await runFormAction("/brands", async () => {
    const brand = await createBrand(getDb(), field(formData, "name"));
    return `Brand "${brand.name}" created.`;
  });
}

export async function renameBrandAction(formData: FormData) {
  await runFormAction("/brands", async () => {
    const brand = await renameBrand(getDb(), field(formData, "id"), field(formData, "name"));
    return `Brand renamed to "${brand.name}".`;
  });
}

export async function deleteBrandAction(formData: FormData) {
  await runFormAction("/brands", async () => {
    await deleteBrand(getDb(), field(formData, "id"));
    return "Brand deleted.";
  });
}
