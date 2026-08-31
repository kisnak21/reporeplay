import { z } from "zod";

export const repositorySchema = z.object({
  id: z.number(),
  full_name: z.string(),
  name: z.string(),
  private: z.boolean(),
  default_branch: z.string().nullable(),
  html_url: z.string().url(),
  owner: z.object({ login: z.string() }),
  size: z.number().optional(),
});

export const refSchema = z.object({
  ref: z.string(),
  object: z.object({ sha: z.string(), type: z.string(), url: z.string() }),
});

export const commitFilesSchema = z.array(
  z.object({
    filename: z.string(),
    previous_filename: z.string().optional(),
    status: z.enum(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
    additions: z.number(),
    deletions: z.number(),
    changes: z.number(),
  }),
);

export const commitSchema = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string().nullable(), email: z.string().nullable(), date: z.string().nullable() }).nullable(),
    committer: z.object({ name: z.string().nullable(), email: z.string().nullable(), date: z.string().nullable() }).nullable(),
    tree: z.object({ sha: z.string() }),
  }),
  parents: z.array(z.object({ sha: z.string() })),
  html_url: z.string().url(),
  stats: z.object({ additions: z.number(), deletions: z.number(), total: z.number() }).optional(),
  files: commitFilesSchema.optional(),
});

export const treeSchema = z.object({
  sha: z.string(),
  tree: z.array(z.object({ path: z.string().optional(), mode: z.string(), type: z.enum(["blob", "tree", "commit"]), sha: z.string() })),
  truncated: z.boolean(),
});

export const contentFileSchema = z.object({
  type: z.literal("file"),
  encoding: z.string(),
  content: z.string(),
  sha: z.string(),
});

export const rateLimitSchema = z.object({
  resources: z.object({
    core: z.object({ limit: z.number(), remaining: z.number(), reset: z.number(), used: z.number() }),
  }),
  rate: z.object({ limit: z.number(), remaining: z.number(), reset: z.number(), used: z.number() }).optional(),
});

export const installationTokenSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
});
