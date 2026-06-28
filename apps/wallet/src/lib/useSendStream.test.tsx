import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentGoogleCredential: vi.fn(),
  sendStream: vi.fn(),
  clientSideReadsAvailable: vi.fn(),
  sendClientSide: vi.fn(),
}));

vi.mock("./api", () => ({
  currentGoogleCredential: mocks.currentGoogleCredential,
  api: { sendStream: mocks.sendStream },
}));

vi.mock("./benzoClient", () => ({
  clientSideReadsAvailable: mocks.clientSideReadsAvailable,
  sendClientSide: mocks.sendClientSide,
}));

import { useSendStream } from "./useSendStream";

describe("useSendStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the streamed API path for hosted Google sessions", async () => {
    const settled = { status: "settled", txHash: "tx_api", prover: "tee", amount: "25000000", onChain: true };
    mocks.currentGoogleCredential.mockReturnValue("google.jwt");
    mocks.sendStream.mockResolvedValue(settled);
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("@mara", "2.5", "memo", "tee");
    });

    expect(r).toEqual(settled);
    expect(mocks.clientSideReadsAvailable).not.toHaveBeenCalled();
    expect(mocks.sendClientSide).not.toHaveBeenCalled();
    expect(mocks.sendStream).toHaveBeenCalledWith(
      { to: "@mara", amount: "2.5", memo: "memo", prover: "tee" },
      expect.any(Function),
    );
  });

  it("keeps the client-side path for local device accounts", async () => {
    mocks.currentGoogleCredential.mockReturnValue(null);
    mocks.clientSideReadsAvailable.mockResolvedValue(true);
    mocks.sendClientSide.mockResolvedValue({ txHash: "tx_local", prover: "local" });
    const { result } = renderHook(() => useSendStream());

    let r: unknown;
    await act(async () => {
      r = await result.current.run("@mara", "2.5", undefined, "local");
    });

    expect(r).toMatchObject({ status: "settled", txHash: "tx_local", prover: "local", amount: "25000000", onChain: true });
    expect(mocks.clientSideReadsAvailable).toHaveBeenCalled();
    expect(mocks.sendClientSide).toHaveBeenCalledWith("@mara", "25000000");
    expect(mocks.sendStream).not.toHaveBeenCalled();
  });
});
