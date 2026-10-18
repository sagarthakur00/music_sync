import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// No StrictMode: the room hook opens an AudioContext and a websocket, which must not be double-mounted.
createRoot(document.getElementById("root")!).render(<App />);
