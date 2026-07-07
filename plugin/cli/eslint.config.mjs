// Flat ESLint config (ESLint 9) + typescript-eslint. The gate runs `eslint . --max-warnings 0`,
// so any lint warning fails the build. Kept to the dependency allowlist: only `eslint` and
// `typescript-eslint` (no `@eslint/js`, which is not allowlisted).
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
];
