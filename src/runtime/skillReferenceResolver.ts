import { SkillConfig, SkillDocItem, SkillFileItem } from "../types";

export function extractReferencedSkillDocPaths(skillMarkdown: string) {
  return Array.from(new Set(skillMarkdown.match(/references\/[A-Za-z0-9_./-]+/g) ?? []));
}

export function extractReferencedSkillAssetPaths(skillMarkdown: string) {
  return Array.from(new Set(skillMarkdown.match(/assets\/[A-Za-z0-9_./-]+/g) ?? []));
}

export function resolveReferencedSkillDocs(skill: SkillConfig, docs: SkillDocItem[]) {
  const referencedPaths = extractReferencedSkillDocPaths(skill.skillMarkdown);
  if (referencedPaths.length === 0) {
    return {
      referencedPaths,
      loadedReferences: [] as SkillDocItem[]
    };
  }

  const loadedReferences = docs.filter((doc) => referencedPaths.includes(doc.path.replace(`${skill.rootPath}/`, "")));
  return {
    referencedPaths,
    loadedReferences
  };
}

export function resolveReferencedSkillAssets(skill: SkillConfig, files: SkillFileItem[]) {
  const assetPaths = extractReferencedSkillAssetPaths(skill.skillMarkdown);
  if (assetPaths.length === 0) {
    return {
      assetPaths,
      loadedAssets: [] as SkillFileItem[]
    };
  }

  const loadedAssets = files.filter(
    (file) => file.kind === "asset" && assetPaths.includes(file.path.replace(`${skill.rootPath}/`, ""))
  );
  return {
    assetPaths,
    loadedAssets
  };
}
