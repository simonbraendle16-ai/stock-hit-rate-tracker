import { ApiError } from "./assistant-api";
import { readResearchQuery, ResearchQueryError } from "./fibonacci-query-values";
export function fibQuery(p: URLSearchParams, context = false) {
  try { return readResearchQuery(p, context); }
  catch (e) { if (e instanceof ResearchQueryError) throw new ApiError(400, e.message); throw e; }
}
