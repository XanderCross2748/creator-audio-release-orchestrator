export type ReleaseDecision = {
  assetStatus: "release_ready" | "needs_review";
  subscriberUpdate: "queued" | "held";
  summary: string;
};

const RELEASE_MARKERS = ["download is ready", "available now", "now available"];

export function decideRelease(transcript: string): ReleaseDecision {
  const normalized = transcript.toLowerCase();
  const announcesRelease = RELEASE_MARKERS.some((marker) => normalized.includes(marker));

  if (announcesRelease) {
    return {
      assetStatus: "release_ready",
      subscriberUpdate: "queued",
      summary: transcript.trim().slice(0, 160),
    };
  }

  return {
    assetStatus: "needs_review",
    subscriberUpdate: "held",
    summary: transcript.trim().slice(0, 160),
  };
}
