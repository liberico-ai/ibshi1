import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/app/api/**/*.ts'],
    ignores: [
      'src/app/api/docs/**',
      'src/app/api/telegram/webhook/**',
      'src/lib/auth.ts',
    ],
    rules: {
      'no-restricted-syntax': ['warn', {
        selector: "MemberExpression[object.name='NextResponse'][property.name='json']",
        message: 'Use successResponse/errorResponse from @/lib/auth instead of NextResponse.json.',
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma scripts (not part of Next.js app)
    "prisma/**",
  ]),
]);

export default eslintConfig;
