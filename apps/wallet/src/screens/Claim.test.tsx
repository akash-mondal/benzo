import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Claim } from "./Claim";

const walletState = vi.hoisted(() => ({
  refresh: vi.fn(async () => true),
  session: { profile: { handle: "tester", name: "Tester" }, handle: "tester" },
}));

const claimStatus = vi.hoisted(() => vi.fn());
const claim = vi.hoisted(() => vi.fn());

vi.mock("../lib/store", () => ({
  useWallet: () => walletState,
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      claimStatus,
      claim,
    },
  };
});

function claimRoute(link: string): string {
  return `/claim#${encodeURIComponent(link)}`;
}

describe("Claim", () => {
  beforeEach(() => {
    claimStatus.mockReset();
    claim.mockReset();
  });

  it("blocks expired claim links before attempting settlement", async () => {
    const expired = "benzo://claim?amount=10000000&app=consumer&exp=1#secret_expired";

    render(
      <MemoryRouter initialEntries={[claimRoute(expired)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-unavailable")).toHaveTextContent("This link expired");
    expect(screen.getByText("No money moved. Ask the sender to send a fresh link.")).toBeInTheDocument();
    expect(claimStatus).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("shows already claimed links as unavailable before attempting settlement", async () => {
    claimStatus.mockResolvedValue({ status: "claimed", amount: "10000000", expiresAt: 4_000_000_000, onChain: true });
    const used = "benzo://claim?amount=10000000&app=consumer&exp=4000000000#secret_used";

    render(
      <MemoryRouter initialEntries={[claimRoute(used)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-unavailable")).toHaveTextContent("This link was already claimed");
    expect(screen.getByText("No money moved. Ask the sender for a fresh link if needed.")).toBeInTheDocument();
    expect(claimStatus).toHaveBeenCalledWith("secret_used", "10000000", "4000000000");
    expect(claim).not.toHaveBeenCalled();
  });

  it("shows refunded links as unavailable before attempting settlement", async () => {
    claimStatus.mockResolvedValue({ status: "refunded", amount: "10000000", expiresAt: 4_000_000_000, onChain: true });
    const refunded = "benzo://claim?amount=10000000&app=consumer&exp=4000000000#secret_refunded";

    render(
      <MemoryRouter initialEntries={[claimRoute(refunded)]}>
        <Claim />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("claim-unavailable")).toHaveTextContent("This link was refunded");
    expect(screen.getByText("No money moved. Ask the sender to send a fresh link.")).toBeInTheDocument();
    expect(claimStatus).toHaveBeenCalledWith("secret_refunded", "10000000", "4000000000");
    expect(claim).not.toHaveBeenCalled();
  });
});
