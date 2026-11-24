import { useEffect, useState } from "react";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";

const labels = ["Send 0.01 ETH", "Confirm in wallet…", "Pending…", "Done"];

export default function MorphTextDemo() {
  const [step, setStep] = useState(0);
  const [block, setBlock] = useState(21_345_678);
  useEffect(() => {
    const timer = setInterval(() => setBlock((b) => b + 1), 2000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4">
      <Button onClick={() => setStep((s) => (s + 1) % labels.length)}>
        <MorphText>{labels[step]}</MorphText>
      </Button>
      <span className="text-2xl font-semibold tabular-nums">
        <MorphText>{block.toLocaleString("en")}</MorphText>
      </span>
    </div>
  );
}
