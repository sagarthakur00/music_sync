import Home from "./pages/Home";
import Room from "./pages/Room";
import { usePathname } from "./lib/router";

export { navigate } from "./lib/router";

const ROOM_PATH = /^\/room\/(\d{6})\/?$/;

export default function App() {
  const path = usePathname();
  const match = ROOM_PATH.exec(path);
  // Keyed by room id so switching rooms always mounts a fresh socket and audio engine.
  if (match) return <Room key={match[1]} roomId={match[1]} />;
  return <Home />;
}
