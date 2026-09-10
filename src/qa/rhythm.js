const DEFAULT_LAYOUT_SIMILARITY = 0.82;
const DEFAULT_MINIMUM_RUN = 3;
const DEFAULT_ASSET_AREA_RATIO = 0.12;
const DEFAULT_BUCKET_SIZE = 0.05;

/**
 * Analyze browser-computed slide geometry for cross-page repetition.
 *
 * This is an advisory signal. It deliberately does not claim that a deck is
 * aesthetically acceptable; that remains a named human review decision.
 */
export function analyzeRenderedRhythm(pages, options = {}) {
  const thresholds = {
    layout_similarity: options.layoutSimilarity ?? DEFAULT_LAYOUT_SIMILARITY,
    minimum_run: options.minimumRun ?? DEFAULT_MINIMUM_RUN,
    dominant_asset_area_ratio: options.dominantAssetAreaRatio ?? DEFAULT_ASSET_AREA_RATIO,
    geometry_bucket_size: options.bucketSize ?? DEFAULT_BUCKET_SIZE
  };
  validateThresholds(thresholds);

  const prepared = pages.map((page) => preparePage(page, thresholds));
  const findings = [
    ...checkExceptionContracts(prepared),
    ...findRepeatedLayoutRuns(prepared, thresholds),
    ...findRepeatedDominantAssets(prepared)
  ];

  return {
    status: findings.some(({ severity }) => severity === "warning") ? "attention" : "passed",
    acceptance_boundary: "Automated rhythm signals are advisory; human visual acceptance remains a separate, named review.",
    thresholds,
    pages: prepared.map(({ page, tokens, dominantAssets, exception }) => ({
      page,
      layout_signature: tokens,
      dominant_assets: dominantAssets,
      exception
    })),
    findings
  };
}

function preparePage(page, thresholds) {
  const width = page.rect?.width || 1;
  const height = page.rect?.height || 1;
  const bucket = thresholds.geometry_bucket_size;
  const tokens = (page.layoutElements ?? [])
    .filter(({ rect }) => rect && rect.width > 0 && rect.height > 0)
    .map(({ kind = "content", rect }) => [
      kind,
      quantize(rect.x / width, bucket),
      quantize(rect.y / height, bucket),
      quantize(rect.width / width, bucket),
      quantize(rect.height / height, bucket)
    ].join(":"))
    .sort();
  const dominantAssets = (page.assets ?? [])
    .map((asset) => ({
      id: asset.id,
      area_ratio: round((asset.rect.width * asset.rect.height) / (width * height)),
      rect: normalizeRect(asset.rect, width, height)
    }))
    .filter(({ id, area_ratio: ratio }) => id && ratio >= thresholds.dominant_asset_area_ratio)
    .sort((left, right) => right.area_ratio - left.area_ratio || left.id.localeCompare(right.id));
  return {
    page: page.page,
    tokens,
    dominantAssets,
    exception: parseException(page.rhythmException, page.rhythmExceptionReason)
  };
}

function findRepeatedLayoutRuns(pages, thresholds) {
  const findings = [];
  let start = 0;
  while (start < pages.length) {
    let end = start;
    const comparisons = [];
    while (end + 1 < pages.length) {
      const left = pages[end];
      const right = pages[end + 1];
      const similarity = multisetSimilarity(left.tokens, right.tokens);
      if (left.tokens.length === 0 || right.tokens.length === 0 || similarity < thresholds.layout_similarity || suppressesLayout(left) || suppressesLayout(right)) break;
      comparisons.push({ from: left.page, to: right.page, similarity: round(similarity) });
      end += 1;
    }
    if (end - start + 1 >= thresholds.minimum_run) {
      const run = pages.slice(start, end + 1);
      findings.push({
        page: run[0].page,
        check: "rendered-layout-repetition",
        severity: "warning",
        evidence: {
          pages: run.map(({ page }) => page),
          reason: `${run.length} consecutive rendered slides have substantially similar browser-computed composition`,
          source: "browser-computed-geometry",
          comparisons,
          threshold: thresholds.layout_similarity,
          signatures: run.map(({ page, tokens }) => ({ page, tokens }))
        }
      });
    }
    start = Math.max(end + 1, start + 1);
  }
  return findings;
}

function findRepeatedDominantAssets(pages) {
  const findings = [];
  const identities = new Set(pages.flatMap(({ dominantAssets }) => dominantAssets.map(({ id }) => id)));
  for (const id of identities) {
    let start = 0;
    while (start < pages.length) {
      if (!hasAsset(pages[start], id) || suppressesAsset(pages[start], id)) { start += 1; continue; }
      let end = start;
      while (end + 1 < pages.length && hasAsset(pages[end + 1], id) && !suppressesAsset(pages[end + 1], id)) end += 1;
      if (end > start) {
        const run = pages.slice(start, end + 1);
        findings.push({
          page: run[0].page,
          check: "rendered-dominant-asset-repetition",
          severity: "warning",
          evidence: {
            pages: run.map(({ page }) => page),
            asset: id,
            reason: `dominant rendered asset ${id} repeats across adjacent slides`,
            source: "browser-computed-geometry",
            occurrences: run.map(({ page, dominantAssets }) => ({ page, ...dominantAssets.find((asset) => asset.id === id) }))
          }
        });
      }
      start = end + 1;
    }
  }
  return findings;
}

function checkExceptionContracts(pages) {
  return pages.flatMap(({ page, exception }) => {
    if (!exception.raw) return [];
    if (!exception.valid) return [{ page, check: "rendered-rhythm-exception", severity: "warning", evidence: { reason: exception.error, declared: exception.raw } }];
    if (!exception.reason) return [{ page, check: "rendered-rhythm-exception", severity: "warning", evidence: { reason: "rhythm exception requires data-qa-rhythm-reason", declared: exception.raw } }];
    return [];
  });
}

function parseException(raw, reason) {
  if (!raw) return { raw: "", reason: "", scopes: [], valid: true };
  const scopes = String(raw).trim().split(/\s+/).filter(Boolean);
  const valid = scopes.every((scope) => scope === "layout" || /^asset:[^\s:]+$/.test(scope));
  return { raw: String(raw), reason: String(reason ?? "").trim(), scopes, valid, ...(!valid ? { error: "rhythm exception must contain only layout or asset:<data-asset-id> scopes" } : {}) };
}

function suppressesLayout(page) { return page.exception.valid && page.exception.reason && page.exception.scopes.includes("layout"); }
function suppressesAsset(page, id) { return page.exception.valid && page.exception.reason && page.exception.scopes.includes(`asset:${id}`); }
function hasAsset(page, id) { return page.dominantAssets.some((asset) => asset.id === id); }

function multisetSimilarity(left, right) {
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  let intersection = 0;
  for (const token of right) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) { intersection += 1; counts.set(token, remaining - 1); }
  }
  return intersection / Math.max(left.length, right.length);
}

function normalizeRect(rect, width, height) {
  return { x: round(rect.x / width), y: round(rect.y / height), width: round(rect.width / width), height: round(rect.height / height) };
}
function quantize(value, size) { return round(Math.round(value / size) * size); }
function round(value) { return Number(value.toFixed(4)); }
function validateThresholds({ layout_similarity: similarity, minimum_run: run, dominant_asset_area_ratio: assetRatio, geometry_bucket_size: bucket }) {
  if (!(similarity > 0 && similarity <= 1)) throw new RangeError("layoutSimilarity must be > 0 and <= 1");
  if (!Number.isInteger(run) || run < 3) throw new RangeError("minimumRun must be an integer >= 3");
  if (!(assetRatio > 0 && assetRatio <= 1)) throw new RangeError("dominantAssetAreaRatio must be > 0 and <= 1");
  if (!(bucket > 0 && bucket <= 0.25)) throw new RangeError("bucketSize must be > 0 and <= 0.25");
}
