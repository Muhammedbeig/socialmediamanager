/** How a Channel's handle is shown: "@acme" for profiles, the Page link for a LinkedIn Page. */
export function handleLabel(network: string, handle: string | null): string | null {
  if (!handle) return null;
  return network === "linkedin_page" ? `linkedin.com/company/${handle}` : `@${handle}`;
}
