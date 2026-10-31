# React host example

This is a separate Vite + React host that mounts the published `embed.js` loader from `VITE_AGENT_APP_URL`.

```sh
npm install
VITE_AGENT_APP_URL=http://127.0.0.1:4173/ npm run dev
```

Open `http://127.0.0.1:4175/`. The React component creates the widget in `useEffect`, registers a read-only host tool, exposes open/close buttons, and destroys the widget during unmount. The host app and AgentGoRound iframe may use different origins.
