import { decideRelease } from "./release_decision.js";

const transcript = "The brush pack download is ready for all studio subscribers.";
console.log(JSON.stringify({ transcript, decision: decideRelease(transcript) }, null, 2));
