import { useState } from "react";
import { NoteBackup } from "@/components/note-backup";
import { Button } from "@/components/primitives/button";

// Made up. A real note comes from your engine and is never written in code.
const note = `mock-note-eth-0.1-1-0x${"3f9a".repeat(31)}`;

export default function NoteBackupDemo() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <NoteBackup note={note} saved={saved} onSavedChange={setSaved} fileName="note-0.1-ETH.txt" />
      <Button disabled={!saved}>{saved ? "Deposit 0.1 ETH" : "Save your note first"}</Button>
    </div>
  );
}
