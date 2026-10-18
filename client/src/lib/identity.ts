// Per-tab identity: a stable id (survives reloads) and a friendly random username.

const ID_KEY = "music_sync.clientId";
const NAME_KEY = "music_sync.username";

const ADJECTIVES = [
  "amber", "brave", "calm", "cosmic", "dreamy", "electric", "fuzzy", "gentle", "golden", "happy",
  "jazzy", "lucky", "mellow", "misty", "neon", "quiet", "rapid", "rusty", "silver", "sleepy",
  "snowy", "sunny", "swift", "velvet", "wild", "witty", "zesty", "lunar", "breezy", "funky",
];
const ANIMALS = [
  "otter", "falcon", "panda", "koala", "tiger", "lynx", "heron", "gecko", "bison", "dolphin",
  "fox", "owl", "seal", "yak", "zebra", "raven", "moose", "lemur", "badger", "quokka",
  "orca", "ibis", "mole", "puffin", "walrus", "ferret", "crane", "hare", "wombat", "newt",
];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export const randomUsername = () => `${pick(ADJECTIVES)}-${pick(ANIMALS)}`;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** sessionStorage, so two tabs on one computer count as two devices. */
export function getClientId(): string {
  const s = storage("session");
  let id = s?.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    s?.setItem(ID_KEY, id);
  }
  return id;
}

export function getUsername(): string {
  const s = storage("local");
  let name = s?.getItem(NAME_KEY);
  if (!name) {
    name = randomUsername();
    s?.setItem(NAME_KEY, name);
  }
  return name;
}

export function setUsername(name: string) {
  storage("local")?.setItem(NAME_KEY, name);
}
