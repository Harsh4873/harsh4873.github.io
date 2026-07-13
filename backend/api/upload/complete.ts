import { authenticate } from "../../lib/auth.js";
import { api, readJsonBody, requireMethod, sendJson } from "../../lib/http.js";
import { completePdfUpload } from "../../lib/openai.js";
import { enforceRateLimit } from "../../lib/rate-limit.js";
import { parseUploadComplete } from "../../lib/validation.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "upload_complete", requests: 12, windowMs: 10 * 60_000 }, res);
  const input = parseUploadComplete(await readJsonBody(req, 64 * 1024));
  const file = await completePdfUpload(input.uploadId, input.partIds, requestId);
  sendJson(res, 200, { file, requestId });
});
