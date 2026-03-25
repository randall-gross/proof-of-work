---
name: prove-init
description: Generate a quality contract for this project. Use --detect to auto-detect frameworks.
---

Generate a `quality-contract.md` file at the project root that defines what "done" means for this project.

## Steps

1. Copy the template from `${CLAUDE_PLUGIN_ROOT}/templates/quality-contract.md` to the project root
2. If the user passed `--detect` as an argument, scan the project for framework markers and customize sections:
   - Check for `tailwind.config.*` → add responsive layout checks to UI Completeness
   - Check for `supabase/` directory → add RLS policy checks to Security
   - Check for `next.config.*` → add Server Component / hydration checks
   - Check for `*.test.*` or `*.spec.*` files → enable Testing section with framework-specific items
   - Check for `.env*` files → add secret leak checks to Security
   - Check for `tsconfig.json` → add TypeScript strict mode checks to Code Hygiene
3. Write the customized quality-contract.md to the project root
4. Tell the user to review and customize the "Project-Specific Rules" section for their needs
