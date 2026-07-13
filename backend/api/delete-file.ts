import { authenticate } from "../lib/auth.js";
import { api, HttpError, readJsonBody, requireMethod, sendJson } from "../lib/http.js";
import { deleteOpenAIFile } from "../lib/openai.js";
import { enforceRateLimit } from "../lib/rate-limit.js";
import { parseDeleteFile } from "../lib/validation.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "delete_file", requests: 30, windowMs: 10 * 60_000 }, res);
  const input = parseDeleteFile(await readJsonBody(req, 4 * 1024));
  const result = await deleteOpenAIFile(input.fileId, requestId);
  if (!result.deleted) {
    throw new HttpError(502, "file_delete_failed", "The private AI copy could not be confirmed deleted.");
  }
  sendJson(res, 200, { ...result, requestId });
});
