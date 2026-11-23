export const statusNames = ['Open', 'In Progress', 'Blocked', 'Done'] as const;
export type Status = typeof statusNames[number];

export const priorityNames = { P0: 'Urgent', P1: 'High', P2: 'Normal', P3: 'Low' } as const;
export type Priority = keyof typeof priorityNames;

const tagTones = ['blue', 'teal', 'violet', 'amber', 'rose', 'slate'] as const;

export function tagTone(tag: string): typeof tagTones[number] {
  let hash = 2166136261;
  for (const character of tag.normalize('NFKC').trim().toLowerCase()) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return tagTones[(hash >>> 0) % tagTones.length];
}
