import { NftCard } from "@/components/nft-card";

const bayc = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";

export default function NftCardDemo() {
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      <NftCard contract={bayc} tokenId={1n} chainId={1} />
      <NftCard contract={bayc} tokenId={7090n} chainId={1} showAttributes />
    </div>
  );
}
