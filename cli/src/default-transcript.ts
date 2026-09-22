import type { Transcript } from "@fast-jev/core";

/** Synthetic demo only. Never a real user session. */
export const defaultDemoTranscript: Transcript = {
  sessionId: "demo-00000000-0000-4000-8000-000000000001",
  messages: [
    { id: "m1", role: "user", content: "Inspect src/auth.ts and run tests." },
    { id: "m2", role: "assistant", content: "I'll read the file and run the test suite." },
  ],
};
