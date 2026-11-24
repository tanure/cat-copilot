import { z } from 'zod';

const path = z.string().max(200);
export const folderCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), parent: path, name: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('move'), path: path.min(1), parent: path }),
  z.object({ type: z.literal('delete'), path: path.min(1), contents: z.enum(['keep', 'delete']) }),
]);
export type FolderCommand = z.infer<typeof folderCommandSchema>;
