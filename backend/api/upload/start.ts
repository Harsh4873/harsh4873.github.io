import { authenticate } from "../../lib/auth.js";
import { api, readJsonBody, requireMethod, sendJson } from "../../lib/http.js";
import { startPdfUpload } from "../../lib/openai.js";
import { enforceRateLimit } from "../../lib/rate-limit.js";
import { parseUploadStart } from "../../lib/validation.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "upload_start", requests: 12, windowMs: 10 * 60_000 }, res);
  const input = parseUploadStart(await readJsonBody(req, 8 * 1024));
  const upload = await startPdfUpload(input, requestId);
  sendJson(res, 201, { upload, requestId });
});
