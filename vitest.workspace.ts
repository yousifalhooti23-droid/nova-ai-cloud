/**
 * Two projects in one run:
 *   - backend/shared: node environment (worker, router, agent, HTTP contract)
 *   - web: jsdom environment (React components, stores, i18n)
 * `npx vitest run` executes both; `--project web` narrows to the UI.
 */
export default ['vitest.config.ts', 'apps/web/vitest.config.ts'];
