import { authenticate } from "../lib/auth.js";
import { api, readJsonBody, requireMethod, sendJson } from "../lib/http.js";
import { summarizePdf } from "../lib/openai.js";
import { enforceRateLimit } from "../lib/rate-limit.js";
import { parseSummarize } from "../lib/validation.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "summarize", requests: 8, windowMs: 15 * 60_000 }, res);
  const input = parseSummarize(await readJsonBody(req, 64 * 1024));
  const result = await summarizePdf(input, requestId);
  sendJson(res, 200, {
    analysis: result.value,
    model: result.model,
    responseId: result.responseId,
    usage: result.usage,
    requestId,
  });
});
