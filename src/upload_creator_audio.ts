import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { uploadCreatorAudio } from "./creator_audio_service.js";

const [filePath, assetKey, contentType] = process.argv.slice(2);
if (!filePath || !assetKey || (contentType !== "audio/mpeg" && contentType !== "audio/wav")) {
  console.error("Usage: npm run upload -- <file> <asset-key> <audio/mpeg|audio/wav>");
  process.exit(1);
}

await uploadCreatorAudio(assetKey, contentType, randomUUID(), await readFile(filePath));
console.log(`Uploaded ${filePath} as ${assetKey}`);
