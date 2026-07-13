import { authenticate } from "../../lib/auth.js";
import { getMaxUploadPartBytes } from "../../lib/config.js";
import {
  api,
  headerValue,
  HttpError,
  queryValue,
  readRawBody,
  requireMethod,
  sendJson,
} from "../../lib/http.js";
import { addPdfUploadPart } from "../../lib/openai.js";
import { enforceRateLimit } from "../../lib/rate-limit.js";
import { parseUploadId } from "../../lib/validation.js";

export const config = { api: { bodyParser: false } };

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "POST");
  const owner = await authenticate(req);
  enforceRateLimit(owner.uid, { name: "upload_part", requests: 80, windowMs: 10 * 60_000 }, res);

  const contentType = headerValue(req, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/octet-stream") {
    throw new HttpError(415, "invalid_content_type", "Upload parts must use application/octet-stream.");
  }
  const uploadId = parseUploadId(queryValue(req, "uploadId") ?? headerValue(req, "x-upload-id"));
  const bytes = await readRawBody(req, getMaxUploadPartBytes());
  if (bytes.length === 0) throw new HttpError(400, "empty_upload_part", "The upload part is empty.");

  const part = await addPdfUploadPart(uploadId, bytes, requestId);
  sendJson(res, 201, { part, requestId });
});
