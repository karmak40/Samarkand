import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint rules.
 *
 * Chosen to catch mistakes, not to enforce a house style — formatting arguments cost
 * more than they return, and TypeScript already covers most of what a linter used to
 * be for. What is left is the class of bug the compiler cannot see: a promise nobody
 * awaits, a `switch` that silently stops handling a new enum member, a condition that
 * is always true because the type says so.
 */
export default tseslint.config(
  {
    // `android/` and `ios/` are the generated native projects — Capacitor's own
    // Java/Gradle and Xcode/Swift files, plus a copy of `dist` each keeps in sync on
    // every `cap sync`. None of it is source this repo owns.
    ignores: ['dist/**', 'dev/shots/**', 'node_modules/**', 'android/**', 'ios/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    rules: {
      // The simulation runs at 60 Hz and allocates per frame; an unawaited promise in
      // that path is a leak nobody will ever trace back.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // A new enum member — an extra damage type, another node kind — must not slip
      // silently into a default branch that was written for something else.
      // A default clause counts as handling the rest — plenty of switches here pick
      // out two interesting cases on purpose. What this still catches is a switch with
      // no default that quietly stops covering a union someone extended.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],

      // `_unused` is a deliberate signal; anything else unused is a leftover.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Rendering code casts a lot around the canvas API, and template literals of
      // numbers are everywhere. Neither is worth the noise.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // The dev harness is plain JS pasted into a browser console, not part of the build,
  // so there is no project to type it against. Two entries rather than one: the first
  // brings its own `languageOptions`, and merging `globals` in separately leaves that
  // alone instead of overwriting it.
  { files: ['dev/**/*.js'], ...tseslint.configs.disableTypeChecked },
  {
    files: ['dev/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    // Config files run in Node.
    files: ['*.config.ts', '*.config.js', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // Build tooling gets its own project: it runs in Node rather than the browser,
        // and sits outside the app's tsconfig. Without this the Vite and Node imports
        // resolve to `any` and every line trips the unsafe-* rules.
        project: './tsconfig.node.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
