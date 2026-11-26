import { createToaster } from "@ui-sdk/core/toast";
import { describe, expect, it, vi } from "vitest";
import { createTestConfig, fakeChainRpc, fakeTxHash, testAccounts } from "../../../test/wagmi";
import { toastTransaction } from "./transaction-toast-core";

describe("toastTransaction", () => {
  it.each([
    ["success", "success", "Transaction confirmed", 1],
    ["reverted", "error", "Transaction reverted", 0],
  ] as const)(
    "follows a %s transaction without any framework",
    async (status, type, title, confirmedCalls) => {
      const chain = fakeChainRpc({ status });
      const config = createTestConfig({ rpc: chain });
      const toaster = createToaster();
      const onConfirmed = vi.fn();

      const id = toastTransaction(config, fakeTxHash, { chainId: 1, toaster, onConfirmed });
      expect(toaster.toasts()[0]).toMatchObject({
        id,
        type: "loading",
        title: "Transaction pending",
        action: { label: "View", href: `https://etherscan.io/tx/${fakeTxHash}` },
      });

      chain.eth_sendTransaction([{ from: testAccounts[0], to: testAccounts[1] }]);
      await vi.waitFor(() => expect(toaster.toasts()[0]).toMatchObject({ id, type, title }));
      expect(onConfirmed).toHaveBeenCalledTimes(confirmedCalls);
    },
  );

  it("shows the outcome again after the pending toast was closed", async () => {
    const chain = fakeChainRpc();
    const toaster = createToaster();
    const id = toastTransaction(createTestConfig({ rpc: chain }), fakeTxHash, { toaster });
    toaster.dismiss(id);

    chain.eth_sendTransaction([{ from: testAccounts[0], to: testAccounts[1] }]);
    await vi.waitFor(() =>
      expect(toaster.toasts().find((t) => t.id === id)).toMatchObject({ type: "success" }),
    );
  });
});
