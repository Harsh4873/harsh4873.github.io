import { authenticate } from "../lib/auth.js";
import { answerFromPaper } from "../lib/groq.js";
import { api, readJsonBody, requireMethod, sendJson } from "../lib/http.js";
import { enforceRateLimit } from "../lib/rate-limit.js";
import { parseAsk } from "../lib/validation.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "ask", requests: 40, windowMs: 10 * 60_000 }, res);
  const input = parseAsk(await readJsonBody(req, 2 * 1024 * 1024));
  const result = await answerFromPaper(input, requestId);
  sendJson(res, 200, {
    answer: result.value,
    model: result.model,
    responseId: result.responseId,
    usage: result.usage,
    requestId,
  });
});
