import { Address } from "@/components/address";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

export default function AddressDemo() {
  return (
    <div className="flex flex-col items-center gap-3">
      <Address address={vitalik} />
      <Address address={vitalik} ens={false} explorer />
      <Address address={vitalik} variant="pill" />
    </div>
  );
}
