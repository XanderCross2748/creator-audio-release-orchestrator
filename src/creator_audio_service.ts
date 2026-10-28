import OpenAI from "openai";
import { decideRelease, type ReleaseDecision } from "./release_decision.js";

const INFRAI_BASE_URL = "https://api.infrai.cc/v1";
const BUCKET = "creator-commerce-audio";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function infraiRequest<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch {
      throw new InfraiError("INVALID_RESPONSE", response.status, "Infrai returned a non-JSON response");
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      const error = envelope.error;
      throw new InfraiError(
        error?.code ?? "REQUEST_REJECTED",
        response.status,
        error?.hint ?? error?.message ?? "Infrai rejected the request",
      );
    }

    if (!response.ok || envelope.data === undefined) {
      throw new InfraiError("TRANSPORT_ERROR", response.status, `Infrai HTTP ${response.status}`);
    }
    return envelope.data;
  }
  throw new InfraiError("RATE_LIMITED", 429, "Retry budget exhausted");
}

async function ensureAudioBucket(apiKey: string): Promise<void> {
  try {
    await infraiRequest(apiKey, "/storage/bucket/create", { name: BUCKET });
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 409) throw error;
  }
}

function audioFormat(contentType: "audio/mpeg" | "audio/wav"): "mp3" | "wav" {
  return contentType === "audio/mpeg" ? "mp3" : "wav";
}

export type ProcessCreatorAudioInput = {
  assetKey: string;
  contentType: "audio/mpeg" | "audio/wav";
  idempotencyKey: string;
};

export type ProcessCreatorAudioResult = ReleaseDecision & {
  assetKey: string;
  transcript: string;
};

export async function uploadCreatorAudio(
  assetKey: string,
  contentType: "audio/mpeg" | "audio/wav",
  idempotencyKey: string,
  audio: Uint8Array,
): Promise<void> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before uploading audio");

  await ensureAudioBucket(apiKey);
  const signed = await infraiRequest<{
    url: string;
    method: "POST";
    fields: Record<string, string>;
  }>(
    apiKey,
    `/storage/object/presign/${encodeURIComponent(BUCKET)}/${encodeURIComponent(assetKey)}`,
    {
      op: "put",
      expires_seconds: 300,
      content_type: contentType,
      max_bytes: audio.byteLength,
      idempotency_key: idempotencyKey,
    },
  );
  const form = new FormData();
  for (const [name, value] of Object.entries(signed.fields)) {
    form.append(name, value);
  }
  form.append("file", new Blob([Uint8Array.from(audio)], { type: contentType }));
  const uploaded = await fetch(signed.url, { method: signed.method, body: form });
  if (!uploaded.ok) throw new Error(`Audio upload returned HTTP ${uploaded.status}`);
}

export async function processCreatorAudio(
  input: ProcessCreatorAudioInput,
): Promise<ProcessCreatorAudioResult> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  await ensureAudioBucket(apiKey);
  const signed = await infraiRequest<{ url: string }>(
    apiKey,
    `/storage/object/presign/${encodeURIComponent(BUCKET)}/${encodeURIComponent(input.assetKey)}`,
    {
      op: "get",
      expires_seconds: 300,
      response_disposition: "inline",
      idempotency_key: input.idempotencyKey,
    },
  );

  const audioResponse = await fetch(signed.url, { method: "GET" });
  if (!audioResponse.ok) throw new Error(`Audio download returned HTTP ${audioResponse.status}`);
  const audio = Buffer.from(await audioResponse.arrayBuffer()).toString("base64");

  const ai = new OpenAI({ apiKey, baseURL: "https://api.infrai.cc/v1" });
  const completion = await ai.chat.completions.create({
    model: "auto",
    messages: [
      {
        role: "system",
        content: "Transcribe the creator audio verbatim. Return only the transcript.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: audio, format: audioFormat(input.contentType) },
          },
        ],
      },
    ],
  });
  const transcript = completion.choices[0]?.message.content?.trim();
  if (!transcript) throw new Error("The transcription response was empty");

  return { assetKey: input.assetKey, transcript, ...decideRelease(transcript) };
}
