// Production stand-in for ./fixtures.js. Builds without
// ELIZA_DEV_ALLOW_TEST_MOCKS=1 resolve every import of ./fixtures.js to this
// module, so the product starts from empty, honest state: no seeded people,
// messages, mail, events, pages, photos, places, notes, files, cards,
// workflows, accounts, device facts, notifications, scripted replies or images.
// Export names must match ./fixtures.js exactly (test/fixtures-parity.test.mjs).
// Values are empty arrays, empty objects or null; nothing here names a person,
// place, account or asset.

export const IMG = {};
export const PEOPLE = [];

export const PN_REC = [];
export const PN_VM = [];
export const PN_SCRIPT = {};
export const PN_SCREEN = [];
export const PN_REPLIES = [];

export const MSG_PHOTOS = [];
export const MSG_SEED = {};
export const MSG_UNREAD = {};
export const MSG_SMART = {};
export const MSG_BOT = {};

export const INBOX_ACCTS = [];
export const INBOX_SEED = [];

export const CAL_SEED = [];
export const CAL_PREP = {};

export const BR_START = null;
export const BR_PAGES = {};
export const BR_ME = null;

export const PH_SEED = [];
export const PH_DESC = {};
export const PH_SHARE = [];

export const MAPS_PLACES = [];
export const MAPS_FAR = [];
export const MAPS_MATCH = [];
export const MAPS_SAVED = null;

export const NOTES_SEED = [];

export const CT_SEED = [];

export const FILES_FOLDERS_EXTRA = [];
export const FILES_SEED = [];

export const WAL_CARDS = [];
export const WAL_TRIPS = [];
export const WAL_MERCH = [];
export const WAL_PASSES = [];

export const WF_SEED = [];

export const ST_ACCOUNTS = [];
export const ST_NETS = [];
export const ST_BT = [];
export const ST_PERM0 = {};
export const ST_MODELS = [];
export const ST_LOG = [];
export const ST_DEVLOG = [];
export const ST_DEVICE = null;
export const ST_ABOUT = null;

export const NOTIF = [];
export const LOCK_SUM = [];
export const QUICK_SETTINGS = {};
export const QUICK_TILES = [];
export const HEADS = null;
export const VOICE = null;
export const ATTENTION_ROWS = [];
export const HOME_DEFAULTS = null;

export const COPY = {};
