import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this worktree. Without this, Next infers the
  // parent monorepo (multiple lockfiles exist) and Turbopack ends up watching
  // every sibling worktree under .claude/worktrees, which is huge and slow.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
