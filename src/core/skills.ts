export const SKILL_BUNDLE_VERSION = 1 as const;

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  instructions: string;
};

export interface SkillLoader {
  list(): Promise<readonly Pick<SkillDefinition, "id" | "name" | "description">[]>;
  load(id: string): Promise<SkillDefinition | undefined>;
}

export class SkillLoadError extends Error {
  readonly code = "skill_load_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "SkillLoadError";
  }
}

export class MemorySkillLoader implements SkillLoader {
  private readonly skills = new Map<string, SkillDefinition>();

  constructor(skills: readonly SkillDefinition[] = []) {
    for (const skill of skills) this.register(skill);
  }

  register(skill: SkillDefinition): void {
    if (!skill.id.trim() || !skill.name.trim()) throw new SkillLoadError("Skill id and name are required");
    if (!skill.instructions.trim()) throw new SkillLoadError(`Skill ${skill.id} has no instructions`);
    if (this.skills.has(skill.id)) throw new SkillLoadError(`Skill ${skill.id} is already registered`);
    this.skills.set(skill.id, { ...skill });
  }

  async list(): Promise<readonly Pick<SkillDefinition, "id" | "name" | "description">[]> {
    return [...this.skills.values()].map(({ id, name, description }) => ({ id, name, description }));
  }

  async load(id: string): Promise<SkillDefinition | undefined> {
    const skill = this.skills.get(id);
    return skill ? { ...skill } : undefined;
  }
}

export type LoadedSkills = {
  version: typeof SKILL_BUNDLE_VERSION;
  skillIds: string[];
  instructions: string;
};

export async function loadSkills(
  loader: SkillLoader,
  skillIds: readonly string[],
  options: { maxInstructionCharacters?: number } = {}
): Promise<LoadedSkills> {
  const uniqueIds = [...new Set(skillIds.map((id) => id.trim()).filter(Boolean))];
  const skills: SkillDefinition[] = [];
  for (const id of uniqueIds) {
    const skill = await loader.load(id);
    if (!skill) throw new SkillLoadError(`Skill ${id} was not found`);
    if (!skill.instructions.trim()) throw new SkillLoadError(`Skill ${id} has no instructions`);
    skills.push(skill);
  }
  const instructions = skills
    .map((skill) => `## Skill: ${skill.name} (${skill.id})\n${skill.instructions.trim()}`)
    .join("\n\n");
  const max = options.maxInstructionCharacters;
  if (max !== undefined && (!Number.isInteger(max) || max < 0)) throw new SkillLoadError("maxInstructionCharacters must be a non-negative integer");
  if (max !== undefined && instructions.length > max) throw new SkillLoadError("Loaded skill instructions exceed the configured limit");
  return { version: SKILL_BUNDLE_VERSION, skillIds: uniqueIds, instructions };
}

export function composeSystemPrompt(basePrompt: string, loadedSkills: LoadedSkills): string {
  const base = basePrompt.trim();
  if (!loadedSkills.instructions) return base;
  return [base, loadedSkills.instructions].filter(Boolean).join("\n\n");
}
