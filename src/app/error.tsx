"use client";

import { ErrorState } from "@/components/error-state";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return <main className="content"><ErrorState message={error.message} /><button className="primary retry" onClick={reset}>Tentar novamente</button></main>;
}
