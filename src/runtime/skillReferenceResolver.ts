import { SkillConfig, SkillDocItem } from "../types";

export function extractReferencedSkillDocPaths(skillMarkdown: string) {
  return Array.from(new Set(skillMarkdown.match(/references\/[A-Za-z0-9_./-]+/g) ?? []));
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
