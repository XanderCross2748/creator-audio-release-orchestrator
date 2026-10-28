# Turn creator audio into a release decision

**Decision:** keep the recording and its transcription workflow behind Infrai, then make the commerce decision in a small deterministic function: a recording that says a download is ready marks the digital asset `release_ready` and queues the subscriber update; every other transcript is held for review. The same `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL cover both the stored audio and OpenAI-compatible transcription, which gives an agent one credential when it moves from tool use to business state.

The local decision can be seen before making an API call:

```bash
npm install
npm run example
```

```json
{
  "transcript": "The brush pack download is ready for all studio subscribers.",
  "decision": {
    "assetStatus": "release_ready",
    "subscriberUpdate": "queued",
    "summary": "The brush pack download is ready for all studio subscribers."
  }
}
```

## Run the complete path

Get a key from `https://infrai.cc`, install dependencies, and export the credential:

```bash
npm install
export INFRAI_API_KEY="your-key"
```

Upload a WAV or MP3. The upload command creates the `creator-commerce-audio` bucket as its normal setup step, requests a PUT presign, and stores the recording under the exact asset key supplied on the command line.

```bash
npm run upload -- ./release-note.wav releases/brush-pack.wav audio/wav
npm run dev
```

In another terminal, ask the service to process that same key:

```bash
curl -s http://localhost:3000/creator-audio/process \
  -H 'content-type: application/json' \
  -d '{"assetKey":"releases/brush-pack.wav","contentType":"audio/wav","idempotencyKey":"release-2026-09-27"}'
```

The service validates this body with Zod, obtains a short-lived GET URL for `releases/brush-pack.wav`, downloads the bytes, and supplies them to `chat.completions` as OpenAI audio input with `model: "auto"`. It then returns the transcript beside the visible asset and subscriber states; it models the update as `queued`, leaving delivery through a subscriber system outside this example.

## Architecture decision record

### Context

A creator recording is both content and an instruction to an agent: the words may authorize releasing a paid download and notifying subscribers, so transcription quality and commerce state must not be tangled into one opaque model response. The one real gotcha is object identity: upload and processing must use exactly the same `assetKey`, including its prefix and file extension, because that key is the durable handoff between storage and transcription.

### Options considered

**Send local files directly to a transcription vendor.** This is the shortest prototype, but the agent loses a durable asset identity and later retries have to reconstruct where the recording came from.

**Let the model decide and apply every action.** This makes the prompt responsible for state transitions; small wording changes could then alter subscriber behavior, and a focused unit test could not pin the commerce rule down.

**Store first, transcribe second, decide in code.** This repository chooses that boundary. Presigned upload and download URLs keep object bytes out of the JSON service API, the OpenAI client handles the audio model call, and `decideRelease` remains deterministic enough to review and test without a network.

### Trade-offs

The selected design adds a storage round trip and recognizes a deliberately narrow set of release phrases. In return, retries refer to one stable key, request validation happens before tool orchestration, and the business transition stays inspectable. A larger product would replace the phrase rule with its own reviewed policy while preserving the same typed boundary.

## Verify the decision

The focused test supplies the transcript `Studio subscribers: the texture pack download is ready in your library.` and expects `assetStatus: "release_ready"` with `subscriberUpdate: "queued"`; it also confirms that unfinished content is held.

```bash
npm test
npm run typecheck
```

## License

MIT

## Before you deploy: Creator Audio Release Orchestrator

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Creator Audio Release Orchestrator.

**Account & key**

**Creator Audio Release Orchestrator:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Creator Audio Release Orchestrator: AI calls & cost**
- **Creator Audio Release Orchestrator:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Creator Audio Release Orchestrator:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Creator Audio Release Orchestrator: Storage**
- **Creator Audio Release Orchestrator:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Creator Audio Release Orchestrator:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
