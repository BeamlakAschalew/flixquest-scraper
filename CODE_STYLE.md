# Code Style Guide

This project uses **Prettier** for code formatting and **ESLint** for linting.

## 📝 Code Style Rules

### Formatting

- **Quotes**: Single quotes (`'`) preferred over double quotes (`"`)
- **Semicolons**: No semicolons (`;`) at the end of statements
- **Line Width**: 80 characters
- **Indentation**: 2 spaces
- **Trailing Commas**: ES5 style (arrays, objects)
- **Arrow Functions**: Avoid parentheses when possible (`x => x` not `(x) => x`)

### Example

```typescript
// ✅ Good
const greeting = 'Hello, World!'
const numbers = [1, 2, 3]

const greet = name => {
  console.log(`Hello, ${name}!`)
}

// ❌ Bad
const greeting = 'Hello, World!'
const numbers = [1, 2, 3]

const greet = name => {
  console.log(`Hello, ${name}!`)
}
```

## 🛠️ Available Commands

### Format Code

```bash
# Format all files
pnpm format

# Check formatting without changing files
pnpm format:check
```

### Lint Code

```bash
# Run ESLint
pnpm lint

# Fix auto-fixable issues
pnpm lint:fix
```

### Type Check

```bash
# Run TypeScript type checking without emitting files
pnpm typecheck
```

### Run All Checks

```bash
# Format, lint, type check, and build
pnpm format && pnpm lint && pnpm typecheck && pnpm build
```

## 📦 Installed Packages

### Prettier

- `prettier` - Code formatter
- Configuration: `.prettierrc`
- Ignore patterns: `.prettierignore`

### ESLint

- `eslint` - Linting utility
- `@typescript-eslint/parser` - TypeScript parser for ESLint
- `@typescript-eslint/eslint-plugin` - TypeScript-specific rules
- `eslint-config-prettier` - Disables ESLint rules that conflict with Prettier
- `eslint-plugin-prettier` - Runs Prettier as an ESLint rule
- Configuration: `eslint.config.mjs`

## 🔧 Configuration Files

### `.prettierrc`

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 80,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

### `eslint.config.mjs`

Key rules:

- `quotes: ['error', 'single']` - Enforce single quotes
- `semi: ['error', 'never']` - Disallow semicolons
- `@typescript-eslint/no-unused-vars` - Warn on unused variables (except `_` prefix)
- `@typescript-eslint/no-explicit-any` - Warn on `any` type usage

## 🔄 VS Code Integration

### Recommended Settings

Add to `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

### Recommended Extensions

- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

## 🚀 Pre-commit Hook (Optional)

To automatically format and lint before committing, you can set up Husky:

```bash
pnpm add -D husky lint-staged

# Initialize husky
pnpm exec husky init

# Add pre-commit hook
echo "pnpm lint-staged" > .husky/pre-commit
```

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["prettier --write", "eslint --fix"]
  }
}
```

## 📋 Best Practices

### 1. Format Before Committing

```bash
pnpm format && pnpm lint:fix
```

### 2. Run Checks Before Pushing

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build
```

### 3. Ignore Auto-generated Files

Both `.prettierignore` and `eslint.config.mjs` are configured to ignore:

- `node_modules/`
- `dist/`
- `*.log`
- Lock files

### 4. Use TypeScript Types

Avoid `any` type - use `unknown` or specific types instead:

```typescript
// ❌ Bad
const data: any = fetchData()

// ✅ Good
const data: unknown = fetchData()
// or
interface User {
  name: string
  age: number
}
const data: User = fetchData()
```

### 5. Ignore Unused Variables with `_` Prefix

```typescript
// Unused variable that ESLint won't complain about
const onClick = (_event: MouseEvent) => {
  console.log('clicked')
}
```

## 🐛 Troubleshooting

### Prettier Not Working

```bash
# Clear cache
pnpm format

# Check Prettier is installed
pnpm list prettier
```

### ESLint Errors

```bash
# Check ESLint config
pnpm lint

# Fix auto-fixable issues
pnpm lint:fix
```

### TypeScript Errors

```bash
# Run type check
pnpm typecheck

# Rebuild
pnpm build
```

## 📚 Resources

- [Prettier Documentation](https://prettier.io/docs/en/)
- [ESLint Documentation](https://eslint.org/docs/latest/)
- [TypeScript ESLint](https://typescript-eslint.io/)

---

**Code formatted with ❤️ using Prettier and ESLint**
