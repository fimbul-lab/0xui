/**
 * `matchMedia` for jsdom, which has none. Queries are evaluated against the
 * media features of an emulated screen: a desktop by default. Change them
 * for a test with `emulateMedia`, like Playwright's `page.emulateMedia`;
 * test/setup.ts puts the desktop back after each test.
 */
export type MediaFeatures = {
  width: number;
  pointer: "fine" | "coarse" | "none";
  hover: "hover" | "none";
  "prefers-reduced-motion": "no-preference" | "reduce";
  "prefers-color-scheme": "light" | "dark";
};

const desktop: MediaFeatures = {
  width: 1024,
  pointer: "fine",
  hover: "hover",
  "prefers-reduced-motion": "no-preference",
  "prefers-color-scheme": "light",
};

let features = desktop;

function matchesFeature(name: string, value: string | undefined) {
  const { width, pointer, hover } = features;
  switch (name) {
    case "min-width":
      return width >= Number.parseFloat(value ?? "");
    case "max-width":
      return width <= Number.parseFloat(value ?? "");
    case "pointer":
    case "any-pointer":
      return value === undefined ? pointer !== "none" : pointer === value;
    case "hover":
    case "any-hover":
      return value === undefined ? hover !== "none" : hover === value;
    case "prefers-reduced-motion":
    case "prefers-color-scheme":
      return features[name] === value;
    default:
      return false;
  }
}

/** Evaluates a media query list, e.g. `not all` or `(max-width: 640px) and (pointer: coarse)`. */
function evaluate(query: string) {
  return query.split(",").some((part) => {
    const [, not, conditions = ""] = /^\s*(not\s+|only\s+)?(.*?)\s*$/i.exec(part) ?? [];
    const matched = conditions.split(/\s+and\s+/i).every((condition) => {
      if (/^(all|screen)$/i.test(condition)) {
        return true;
      }
      const feature = /^\(\s*([a-z-]+)\s*(?::\s*(.+?))?\s*\)$/i.exec(condition);
      const name = feature?.[1];
      return name ? matchesFeature(name.toLowerCase(), feature[2]) : false;
    });
    return /^not/i.test(not ?? "") ? !matched : matched;
  });
}

class EmulatedMediaQueryList extends EventTarget {
  onchange: ((event: Event) => void) | null = null;
  #last: boolean;

  constructor(readonly media: string) {
    super();
    this.#last = this.matches;
  }

  get matches() {
    return evaluate(this.media);
  }

  addListener(listener: (event: Event) => void) {
    this.addEventListener("change", listener);
  }

  removeListener(listener: (event: Event) => void) {
    this.removeEventListener("change", listener);
  }

  /** Fires `change` when the emulated screen no longer gives the same answer. */
  update() {
    const { matches } = this;
    if (matches === this.#last) {
      return;
    }
    this.#last = matches;
    const event = Object.assign(new Event("change"), { matches, media: this.media });
    this.onchange?.(event);
    this.dispatchEvent(event);
  }
}

const lists = new Set<EmulatedMediaQueryList>();

function setFeatures(next: MediaFeatures) {
  features = next;
  for (const list of lists) {
    list.update();
  }
}

/** Gives the screen these media features until the test ends. */
export function emulateMedia(changes: Partial<MediaFeatures>) {
  setFeatures({ ...features, ...changes });
}

/** Back to the default desktop screen. */
export function resetMedia() {
  setFeatures(desktop);
}

export function installMatchMedia() {
  // oxlint-disable-next-line landmines/no-test-doubles -- jsdom lacks matchMedia
  window.matchMedia = (query: string) => {
    const list = new EmulatedMediaQueryList(query);
    lists.add(list);
    return list;
  };
}
