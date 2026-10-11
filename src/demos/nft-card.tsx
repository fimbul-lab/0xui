import { NftCard } from "@/components/nft-card";
import { demo } from "./demo";

const bayc = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";

export const Default = demo(() => (
  <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
    <NftCard contract={bayc} tokenId={1n} chainId={1} />
    <NftCard contract={bayc} tokenId={7090n} chainId={1} />
    <NftCard contract={bayc} tokenId={99999n} chainId={1} />
  </div>
));

export const WithTraits = demo(() => (
  <NftCard contract={bayc} tokenId={1n} chainId={1} showAttributes />
));
