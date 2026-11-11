import { vi } from "vitest";

// Tests publish to the fake Connector only.
process.env.ENABLE_FAKE_CONNECTOR = "1";

// Tests never touch Windows Credential Manager: they encrypt tokens with a fixed key.
vi.mock("@/secrets/keystore", () => ({
  getTokenKey: async () => Buffer.alloc(32, 7),
}));
