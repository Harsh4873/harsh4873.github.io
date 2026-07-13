import { api, requireMethod, sendJson } from "../lib/http.js";
import { enforceRateLimit } from "../lib/rate-limit.js";

export default api(async (req, res, { requestId }) => {
  requireMethod(req, res, "GET");
  const forwarded = req.headers["x-forwarded-for"];
  const subject = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "unknown";
  enforceRateLimit(subject, { name: "health", requests: 120, windowMs: 60_000 }, res);
  sendJson(res, 200, {
    ok: true,
    service: "sift-research-api",
    version: 1,
    requestId,
  });
});
