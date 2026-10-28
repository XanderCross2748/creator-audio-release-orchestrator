import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, processCreatorAudio } from "./creator_audio_service.js";

const requestSchema = z.object({
  assetKey: z.string().min(1).max(512),
  contentType: z.enum(["audio/mpeg", "audio/wav"]),
  idempotencyKey: z.string().min(8).max(128),
});

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/creator-audio/process") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    send(response, 400, { error: "Request body must be JSON" });
    return;
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    send(response, 400, { error: "Invalid request", issues: parsed.error.issues });
    return;
  }

  try {
    send(
      response,
      200,
      await processCreatorAudio({
        assetKey: parsed.data.assetKey,
        contentType: parsed.data.contentType,
        idempotencyKey: parsed.data.idempotencyKey,
      }),
    );
  } catch (error) {
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      send(response, error.status, { error: error.message, code: error.code });
      return;
    }
    console.error(error);
    send(response, 500, { error: "Audio processing failed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Creator audio service listening on http://localhost:${port}`));
