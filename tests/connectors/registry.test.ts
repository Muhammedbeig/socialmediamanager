import { describe, expect, it } from "vitest";
import { connectLabel, connectOptionFor, entryKey, getNetwork } from "@/connectors/registry";

describe("ways to connect Instagram", () => {
  it("offers Instagram through Facebook and directly, as two buttons on one network", () => {
    const viaFacebook = getNetwork("instagram")!;
    const direct = getNetwork("instagram-login")!;
    expect(viaFacebook.network).toBe("instagram");
    expect(direct.network).toBe("instagram");
    expect(connectLabel(viaFacebook)).toBe("Connect Instagram through Facebook");
    expect(connectLabel(direct)).toBe("Connect Instagram directly");
    expect(direct.requiredEnv).toEqual(["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"]);
  });

  it("reconnects and refreshes a Channel the way it connected", () => {
    expect(entryKey(connectOptionFor({ network: "instagram", settings: { login: "instagram" } })!)).toBe("instagram-login");
    expect(entryKey(connectOptionFor({ network: "instagram", settings: { login: "facebook" } })!)).toBe("instagram");
    // Channels from before there were two ways have no login saved: they came through Facebook.
    expect(entryKey(connectOptionFor({ network: "instagram", settings: {} })!)).toBe("instagram");
    expect(entryKey(connectOptionFor({ network: "facebook", settings: {} })!)).toBe("facebook");
  });
});
