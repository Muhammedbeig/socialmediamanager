import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UserError } from "@/domain/errors";

/**
 * Runs the body of a server action, then returns to `path`.
 * A UserError is shown on that screen; anything else is a bug and surfaces as one.
 */
export async function runFormAction(path: string, body: () => Promise<string | void>): Promise<never> {
  let notice: string | void;
  try {
    notice = await body();
  } catch (error) {
    if (error instanceof UserError) {
      redirect(`${path}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
  revalidatePath(path);
  redirect(notice ? `${path}?notice=${encodeURIComponent(notice)}` : path);
}

export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
