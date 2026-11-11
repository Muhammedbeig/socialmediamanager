import { describe, expect, it } from "vitest";
import { computePostStatus } from "@/domain/post-status";

describe("computePostStatus", () => {
  it("is Scheduled when every Delivery is Scheduled", () => {
    expect(computePostStatus(["scheduled", "scheduled"])).toBe("scheduled");
  });

  it("is Publishing while any Delivery is Publishing", () => {
    expect(computePostStatus(["published", "publishing", "failed"])).toBe("publishing");
  });

  it("is Publishing while a Delivery Needs attention", () => {
    expect(computePostStatus(["published", "needs_attention"])).toBe("publishing");
  });

  it("is Publishing when some Deliveries finished and others still wait", () => {
    expect(computePostStatus(["published", "scheduled"])).toBe("publishing");
    expect(computePostStatus(["failed", "scheduled"])).toBe("publishing");
  });

  it("is Published when every Delivery is Published", () => {
    expect(computePostStatus(["published", "published", "published"])).toBe("published");
  });

  it("is Partly published when some Deliveries Published and some Failed", () => {
    expect(computePostStatus(["published", "failed"])).toBe("partly_published");
  });

  it("is Failed when every Delivery Failed", () => {
    expect(computePostStatus(["failed", "failed"])).toBe("failed");
  });

  it("is Removed only when every Delivery is Removed", () => {
    expect(computePostStatus(["removed", "removed"])).toBe("removed");
  });

  it("ignores Removed Deliveries when others remain", () => {
    expect(computePostStatus(["removed", "published"])).toBe("published");
    expect(computePostStatus(["removed", "failed"])).toBe("failed");
    expect(computePostStatus(["removed", "published", "failed"])).toBe("partly_published");
  });

  it("treats a Post with no Deliveries as Scheduled", () => {
    expect(computePostStatus([])).toBe("scheduled");
  });
});
