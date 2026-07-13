import { authenticate } from "../lib/auth.js";
import { api, readJsonBody, requireMethod, sendJson } from "../lib/http.js";
import { answerFromPdf } from "../lib/openai.js";
import { enforceRateLimit } from "../lib/rate-limit.js";
import { parseAsk } from "../lib/validation.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "ask", requests: 40, windowMs: 10 * 60_000 }, res);
  const input = parseAsk(await readJsonBody(req, 64 * 1024));
  const result = await answerFromPdf(input, requestId);
  sendJson(res, 200, {
    answer: result.value,
    model: result.model,
    responseId: result.responseId,
    usage: result.usage,
    requestId,
  });
});
