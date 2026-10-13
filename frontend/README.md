# Frontend

React 19, Vite, and TypeScript scaffold for the Xatlov application.

## UI foundations

- Ant Design 6.6.6 is the primary component library for tables, forms, dialogs, and other standard controls.
- Tailwind CSS 4.3.3 is integrated through its Vite plugin and is intended for page layout and utility styling.
- Ant Design's CSS-in-JS styles are placed in the `antd` cascade layer so Tailwind utilities can override them when needed.
- shadcn/ui is not installed; add a component only when a specific requirement benefits from it.

## Install and run

```sh
npm install
npm run dev
```

Use `npm run build` to create a production build and `npm run lint` to check the source with ESLint.
