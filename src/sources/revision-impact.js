// A conservative page-level preview until the fact ledger in #90 can supply
// exact claim and field bindings. Unknown locators are never called unaffected.
export function compareSourceRevision(oldSource, newSource, oldExtraction, newExtraction, pages) {
  const oldSegments = new Map(oldExtraction.segments.map((item) => [item.locator, item.text]));
  const newSegments = new Map(newExtraction.segments.map((item) => [item.locator, item.text]));
  const changedLocators = [...new Set([...oldSegments.keys(), ...newSegments.keys()])]
    .filter((locator) => oldSegments.get(locator) !== newSegments.get(locator)).sort();
  const changed = oldSource.sha256 !== newSource.sha256 || JSON.stringify(oldExtraction) !== JSON.stringify(newExtraction);
  const pageImpacts = pages.flatMap((page) => (page.source_refs ?? [])
    .filter((ref) => ref.source_id === oldSource.id)
    .map((ref) => {
      const locator = ref.locator ?? "";
      const exact = locator && oldSegments.has(locator) && newSegments.has(locator);
      const status = !changed ? "unchanged" : !exact ? "manual_review" :
        oldSegments.get(locator) === newSegments.get(locator) ? "unchanged_at_locator" : "needs_revision";
      return { page_id: page.id, page: page.page, locator, status,
        ...(status === "needs_revision" ? { old_text: oldSegments.get(locator), new_text: newSegments.get(locator) } : {}) };
    }));
  return {
    old_source: { id: oldSource.id, sha256: oldSource.sha256, extraction_file: oldSource.extraction_file },
    new_source: { id: newSource.id, sha256: newSource.sha256, extraction_file: newSource.extraction_file },
    duplicate: oldSource.sha256 === newSource.sha256,
    changed_locators: changedLocators,
    page_impacts: pageImpacts,
    // A matching locator does not prove that a moved or renamed passage is safe.
    limitations: ["page-level source_refs cannot prove field-level impact; verify unchanged locators when source structure moves", "source content is not fact verification"]
  };
}
