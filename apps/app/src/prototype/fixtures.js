// Prototype fixture data: seeded people, conversations, mail, events, pages,
// photos, places, notes, files, wallet, workflows, settings, shell copy and
// scripted replies. Only test-mocks builds bundle this module. Production
// builds (ELIZA_DEV_ALLOW_TEST_MOCKS unset) swap it for fixtures.empty.js,
// which has the same export names with empty or neutral values, so nothing
// here may be required for the live product to render.
// Every name, address, number and organisation below is fictional.

/* Generated photography (see README.md). Emitted only when this module is bundled. */
export const IMG = {
  "cam_park": new URL("./fixtures/img/cam_park.webp", import.meta.url).href,
  "cam_poster": new URL("./fixtures/img/cam_poster.webp", import.meta.url).href,
  "cam_selfie": new URL("./fixtures/img/cam_selfie.webp", import.meta.url).href,
  "enclave": new URL("./fixtures/img/enclave.webp", import.meta.url).href,
  "msg0": new URL("./fixtures/img/msg0.webp", import.meta.url).href,
  "msg1": new URL("./fixtures/img/msg1.webp", import.meta.url).href,
  "msg2": new URL("./fixtures/img/msg2.webp", import.meta.url).href,
  "msg3": new URL("./fixtures/img/msg3.webp", import.meta.url).href,
  "news": new URL("./fixtures/img/news.webp", import.meta.url).href,
  "nopa": new URL("./fixtures/img/nopa.webp", import.meta.url).href,
  "p01": new URL("./fixtures/img/p01.webp", import.meta.url).href,
  "p02": new URL("./fixtures/img/p02.webp", import.meta.url).href,
  "p03": new URL("./fixtures/img/p03.webp", import.meta.url).href,
  "p04": new URL("./fixtures/img/p04.webp", import.meta.url).href,
  "p05": new URL("./fixtures/img/p05.webp", import.meta.url).href,
  "p06": new URL("./fixtures/img/p06.webp", import.meta.url).href,
  "p07": new URL("./fixtures/img/p07.webp", import.meta.url).href,
  "p08": new URL("./fixtures/img/p08.webp", import.meta.url).href,
  "p09": new URL("./fixtures/img/p09.webp", import.meta.url).href,
  "p10": new URL("./fixtures/img/p10.webp", import.meta.url).href,
  "p11": new URL("./fixtures/img/p11.webp", import.meta.url).href,
  "p12": new URL("./fixtures/img/p12.webp", import.meta.url).href,
  "p13": new URL("./fixtures/img/p13.webp", import.meta.url).href,
  "p14": new URL("./fixtures/img/p14.webp", import.meta.url).href,
  "p15": new URL("./fixtures/img/p15.webp", import.meta.url).href,
  "p16": new URL("./fixtures/img/p16.webp", import.meta.url).href,
  "p17": new URL("./fixtures/img/p17.webp", import.meta.url).href,
  "p18": new URL("./fixtures/img/p18.webp", import.meta.url).href,
  "p19": new URL("./fixtures/img/p19.webp", import.meta.url).href,
  "p20": new URL("./fixtures/img/p20.webp", import.meta.url).href,
  "p21": new URL("./fixtures/img/p21.webp", import.meta.url).href,
  "p22": new URL("./fixtures/img/p22.webp", import.meta.url).href,
  "p23": new URL("./fixtures/img/p23.webp", import.meta.url).href,
  "p24": new URL("./fixtures/img/p24.webp", import.meta.url).href,
  "p25": new URL("./fixtures/img/p25.webp", import.meta.url).href,
  "p26": new URL("./fixtures/img/p26.webp", import.meta.url).href,
  "p27": new URL("./fixtures/img/p27.webp", import.meta.url).href,
  "p28": new URL("./fixtures/img/p28.webp", import.meta.url).href,
  "p29": new URL("./fixtures/img/p29.webp", import.meta.url).href,
  "p30": new URL("./fixtures/img/p30.webp", import.meta.url).href,
  "p31": new URL("./fixtures/img/p31.webp", import.meta.url).href,
  "p32": new URL("./fixtures/img/p32.webp", import.meta.url).href
};

export const PEOPLE = [
  { id: "maya", name: "Maya Chen", ini: "MC", phone: "(415) 555-0132", email: "maya@lumen.example", fav: true, note: "Design lead at Lumen" },
  { id: "jordan", name: "Jordan Park", ini: "JP", phone: "(212) 555-0187", email: "jordan@northpoint.example", fav: true, note: "Partner, Northpoint" },
  { id: "priya", name: "Priya Nair", ini: "PN", phone: "(650) 555-0144", email: "priya@nair.example", fav: true, note: "" },
  { id: "sam", name: "Sam Okafor", ini: "SO", phone: "(510) 555-0199", email: "sam@okafor.example", fav: false, note: "" },
  { id: "lena", name: "Lena Ruiz", ini: "LR", phone: "(718) 555-0121", email: "lena@ruiz.example", fav: false, note: "" },
  { id: "dad", name: "Dad", ini: "D", phone: "(503) 555-0110", email: "", fav: true, note: "" }
];

export const PN_REC = [
  { id: "r1", pid: "maya", dir: "missed", ago: 12, dur: 0 },
  { id: "r2", pid: null, num: "(628) 555-0199", dir: "in", ago: 52, dur: 24, screened: true, note: "Spam: car warranty. Declined for you." },
  { id: "r3", pid: "jordan", dir: "out", ago: 190, dur: 740, note: "Pro-rata to 15%. He sends the revised sheet tonight." },
  { id: "r4", pid: "dad", dir: "in", ago: 1300, dur: 1260 },
  { id: "r5", pid: "priya", dir: "out", ago: 1570, dur: 95 },
  { id: "r6", pid: "sam", dir: "missed", ago: 3000, dur: 0 },
  { id: "r7", pid: "lena", dir: "in", ago: 4500, dur: 300 }
];
export const PN_VM = [
  { id: "v1", pid: "maya", ago: 11, dur: 18, heard: false, gist: "she wants to push the review to 3:30", text: "Hey, it's Maya. Quick one: can we push the review to 3:30? I want to get the prototype on the device first. Call me back." },
  { id: "v2", pid: "dad", ago: 1320, dur: 34, heard: true, gist: "are you coming up for the weekend?", text: "Hi kiddo, just checking in. Mom wants to know if you're coming up for the weekend. No rush, call when you can." },
  { id: "v3", pid: null, num: "(212) 555-0100", label: "Dr. Patel's office", ago: 2900, dur: 22, heard: true, gist: "confirm Thursday at 10 AM", text: "This is Dr. Patel's office confirming your appointment Thursday at 10 AM. Please call back to confirm." }
];
/* live transcript Alpha writes when you turn it on during a call */
export const PN_SCRIPT = {
  maya: { lines: [["them", "Hey, got a sec?"], ["you", "Yeah, what's up?"], ["them", "Can we do the review at 3:30 instead?"], ["you", "Works. Bring the prototype."], ["them", "Will do. See you then."]], sum: "Review moved to 3:30. Maya brings the prototype." },
  jordan: { lines: [["them", "Saw the redlines?"], ["you", "Yes. Pro-rata is the sticking point."], ["them", "I can get us to 15%."], ["you", "Do it. Send the revised sheet."]], sum: "Pro-rata at 15%. Jordan sends the revised sheet." },
  dad: { lines: [["them", "Hey kiddo!"], ["you", "Hi Dad. Got your message."], ["them", "Coming up this weekend?"], ["you", "Saturday morning, probably."]], sum: "Visiting Saturday morning." },
  _: { lines: [["them", "Hi, thanks for calling back."], ["you", "Of course. What do you need?"], ["them", "Just confirming Thursday."], ["you", "Thursday works."]], sum: "Confirmed Thursday." }
};
export const PN_SCREEN = [["alpha", "Hi, this is {name}, answering for you. What's it about?"], ["them", "Hey, it's Maya. I'm running ten minutes late for three."], ["alpha", "Got it, I'll pass it on. Anything else?"], ["them", "Nope, that's it. Thanks!"]];
export const PN_REPLIES = ["Can't talk now. Call you later?", "On my way.", "Running a few minutes late."];

export const MSG_PHOTOS = [
  "linear-gradient(160deg,#F2B880 0%,#D9785B 55%,#4B3B6B 100%)",
  "linear-gradient(200deg,#9AD0EC 0%,#4F86C6 60%,#233D6E 100%)",
  "linear-gradient(170deg,#C7E3B0 0%,#6FA56B 55%,#2F4F3A 100%)",
  "linear-gradient(150deg,#F5E1C8 0%,#C9A27A 60%,#6B4E3A 100%)"
];
// k = minutes since midnight today (negative = yesterday)
export const MSG_SEED = {
  maya: [
    { me: false, text: "Pushed the new flows to Figma", k: -330 },
    { me: true, text: "Looks great. Review tomorrow?", k: -322 },
    { me: false, text: "Yes! Put it on the calendar", k: -321 },
    { me: true, text: "Design review is at 3", k: 750 },
    { me: false, text: "Still on for 3? I can bring the prototype.", k: 844 }
  ],
  priya: [
    { me: true, text: "Saturday was so fun", k: -600 },
    { me: false, text: "Right?? Lunch Tuesday?", k: -590 },
    { me: true, text: "Yes. Tartine at 1", k: -588 },
    { me: false, text: "Sent you the photos from Saturday", k: 700 },
    { me: false, photo: 0, k: 700 },
    { me: false, photo: 1, k: 700 }
  ],
  jordan: [
    { me: false, text: "Can we do 4:30 instead of 4?", k: 615 },
    { me: true, text: "Works.", k: 618 }
  ],
  sam: [
    { me: false, text: "Running 10 min late to standup", k: 562 },
    { me: true, text: "No worries", k: 563 }
  ],
  dad: [
    { me: false, text: "Did you see the game last night?", k: -700 },
    { me: true, text: "Missed it! Call you Sunday", k: -650 },
    { me: false, text: "Ok. Love you", k: -640 }
  ]
};
export const MSG_UNREAD = { maya: 1, priya: 3 };
export const MSG_SMART = {
  maya: [["See you at 3", "Yes, see you at 3. Bring the prototype!"], ["Bring it", "Yes, bring it. Can't wait to try it."], ["Running 5 late", "Running 5 late, start without me."]],
  priya: [["These are great", "These are great, thank you!"], ["Send the rest?", "Love these. Send the rest?"], ["Tuesday still on?", "Still on for Tuesday at 1?"]],
  jordan: [["Works", "Works for me."], ["Can we do 5?", "Can we push to 5?"]],
  dad: [["Love you too", "Love you too, Dad."], ["Call Sunday?", "Call you Sunday?"]],
  sam: [["No worries", "No worries."], ["Thanks", "Thanks!"]]
};
export const MSG_BOT = {
  maya: ["Perfect. See you at 3.", "Bringing the new build too, it's much faster.", "Ha, ok. On my way."],
  priya: ["Glad you like them!", "More coming tonight."],
  jordan: ["Great, talk then.", "Sounds good."],
  sam: ["Cool.", "On it."],
  dad: ["Talk soon kiddo.", "Love you."]
};

export const INBOX_ACCTS = [
  { id: "personal", label: "Personal", provider: "google", address: "me@gmail.example", mail: true, calendar: true, contacts: true },
  { id: "work", label: "Work", provider: "microsoft", address: "me@alphacompute.example", mail: true, calendar: true, contacts: true }
];
export const INBOX_SEED = [
  { id: 2, pid: "jordan", acct: "work", k: 793, time: "1:12 PM", unread: true, subj: "Revised term sheet",
    body: "Hi,\n\nAttached is the revised term sheet. We moved on the pro-rata and tightened the board language as discussed.\n\nNeed your eyes by Friday so we can get it to counsel. Happy to walk through it on our 4:30.\n\nJordan",
    atts: [{ name: "Term sheet v3.pdf", size: "212 KB", file: "termsheet" }],
    gist: "Revised term sheet, needs your eyes by Friday", draft: "Thanks Jordan. Reading it tonight, notes to you by Friday." },
  { id: 1, pid: "maya", acct: "work", k: 768, time: "12:48 PM", unread: true, subj: "Notes for the 3:00 review",
    body: "Notes for this afternoon attached. Pages 6 to 9 are the new onboarding flow, that's where I'd love your call.\n\nMaya",
    atts: [{ name: "Design review notes.pdf", size: "1.1 MB", file: "designnotes" }],
    gist: "Notes for the 3:00 review, wants your call on the onboarding pages", draft: "Thanks Maya, reading now. The onboarding pages look strong." },
  { id: 4, pid: "lena", acct: "personal", k: 570, time: "9:30 AM", unread: true, subj: "Dinner Friday?",
    body: "We're doing tacos at ours on Friday around 7. Bring nothing but yourself. Sam's coming too.\n\nL",
    gist: "Tacos at hers Friday at 7", draft: "Count me in. See you Friday at 7!" },
  { id: 5, pid: "sam", acct: "work", k: 588, time: "9:48 AM", unread: false, subj: "Standup notes",
    body: "Quick notes from standup:\n\n- Build 0.9 goes to beta testers Thursday\n- Redaction eval is green on all devices\n- Maya owns the onboarding copy\n\nSam",
    gist: "Standup notes, beta build Thursday", draft: "Thanks Sam, all good on my side." },
  { id: 3, name: "GPU Reserve", ini: "GR", email: "no-reply@gpureserve.example", acct: "work", k: 545, time: "9:05 AM", unread: false, subj: "Reservation confirmed · Oct 2",
    body: "Your reservation for 8 × H200 on October 2, 09:00 to 21:00 PT is confirmed.\n\nReference GR-20417.",
    gist: "GPU reservation confirmed for Oct 2", draft: "Thanks, confirmed." },
  { id: 6, name: "Tartine", ini: "T", email: "hello@tartine.example", acct: "personal", k: 492, time: "8:12 AM", unread: false, subj: "Table for 2 at 1:00",
    body: "See you today at 1:00 PM. Table for 2 under your name, Guerrero St.\n\nReply to this email to change your booking.",
    gist: "Lunch booking at 1:00 confirmed", draft: "Thanks, see you at 1." },
  { id: 7, name: "Alaska Airlines", ini: "AS", email: "trips@alaskaair.example", acct: "personal", k: -300, time: "Yesterday", unread: false, subj: "Your trip to Portland",
    body: "SFO to PDX, Saturday Oct 4, 8:40 AM. Seat 7A.\n\nCheck-in opens 24 hours before departure.",
    gist: "Portland flight Saturday 8:40 AM", draft: "Thanks." }
];

export const CAL_SEED = [
  { id: "c1", off: -14, t: 9.5, d: 0.5, title: "Standup", cal: "work", repeat: "weekdays", video: "meet.lumen.example/standup", where: "", who: ["maya", "sam"], rsvp: { maya: "yes", sam: "yes" }, notes: "" },
  { id: "c2", off: 0, t: 11, d: 1.5, title: "Deep work", cal: "work", hold: true, where: "", who: [], notes: "Enclave copy, then the onboarding flow." },
  { id: "c3", off: 0, t: 13, d: 1, title: "Lunch · Priya", cal: "personal", where: "Tartine, Guerrero St", who: ["priya"], rsvp: { priya: "yes" }, notes: "" },
  { id: "c4", off: 0, t: 15, d: 1, title: "Design review", cal: "work", key: true, video: "meet.lumen.example/design-review", where: "", who: ["maya", "jordan", "sam", "lena"], rsvp: { maya: "yes", jordan: "maybe", sam: "yes", lena: "yes" }, notes: "Walk through the onboarding prototype. Decide on the enclave copy before Friday." },
  { id: "c5", off: 0, t: 16.5, d: 0.5, title: "Jordan · term sheet", cal: "work", where: "Phone", who: ["jordan"], rsvp: { jordan: "yes" }, notes: "Revised term sheet is in your inbox." },
  { id: "c6", off: 0, t: 19.5, d: 1, title: "Gym", cal: "personal", where: "Equinox SoMa", who: [], notes: "" },
  { id: "c11", off: -1, t: 8.5, d: 0.5, title: "Coffee · Lena", cal: "personal", where: "Sightglass, 7th St", who: ["lena"], notes: "" },
  { id: "c12", off: -1, t: 14, d: 1, title: "Roadmap review", cal: "work", video: "meet.lumen.example/roadmap", where: "", who: ["maya", "sam"], notes: "" },
  { id: "c8", off: 1, t: 10, d: 0.5, title: "1:1 · Maya", cal: "work", video: "meet.lumen.example/maya", where: "", who: ["maya"], notes: "" },
  { id: "c9", off: 1, t: 14, d: 1, title: "Dentist", cal: "personal", where: "Mission Dental, Valencia St", who: [], alert: 60, notes: "" },
  { id: "c13", off: 2, t: 9, d: 2, title: "Board prep", cal: "work", where: "Lumen HQ, 3rd floor", who: ["jordan", "maya"], notes: "" },
  { id: "c14", off: 2, t: 19, d: 1.5, title: "Dinner · Dad", cal: "personal", where: "Zuni Café", who: ["dad"], notes: "" },
  { id: "c10", off: 3, t: 19, d: 2, title: "Northpoint partner dinner", cal: "work", where: "Nopa, Divisadero St", who: ["jordan", "priya"], invite: { from: "jordan", status: "pending" }, notes: "Partners and founders, informal. Jordan would like you to say a few words about the enclave." },
  { id: "c15", off: 4, t: 13, d: 1, title: "Offsite planning", cal: "work", video: "meet.lumen.example/offsite", where: "", who: ["maya", "lena"], notes: "" },
  { id: "c16", off: 5, t: 10, d: 2, title: "Farmers market", cal: "personal", where: "Ferry Building", who: ["priya"], notes: "" }
];
/* Hand-written meeting prep for the reference design review. */
export const CAL_PREP = {
  c4: ["Maya is bringing the onboarding prototype. Her last note asks for a call on the enclave copy.", "Jordan is a maybe; his revised term sheet landed at 1:12 and may come up.", "Open question from Friday: ship keys-on-device doc before or after the dry run."]
};

const BR_NEWS = "news.example/on-device-agents", BR_ENC = "enclave.example/keys-in-hardware", BR_BOOK = "tables.example/nopa";
/* Reference tabs, bookmarks and history, plus the restaurant the booking demo fills in. */
export const BR_START = {
  news: BR_NEWS, enc: BR_ENC, book: BR_BOOK, venue: "Nopa",
  tabs: [{ id: "t1", hist: [BR_NEWS], pos: 0 }, { id: "t2", hist: [BR_ENC], pos: 0 }], cur: "t1",
  marks: [BR_ENC], visits: [BR_NEWS, BR_ENC, BR_BOOK]
};
export const BR_PAGES = {};
BR_PAGES[BR_NEWS] = { kind: "news", title: "The case for on-device agents", host: "news.example", path: "/on-device-agents", tile: "#000000",
  snip: "An assistant that lives on your phone sees everything you do. The question is who else gets to see it.", kw: "agents on-device ai assistant privacy phone news",
  points: ["Keeping model and memory on the phone means nobody else sees your data", "Hardware-held keys make every agent action signed and checkable", "The interface should get quieter: one conversation, the right card at the right time"] };
BR_PAGES[BR_ENC] = { kind: "enclave", title: "Keys that never leave the chip", host: "enclave.example", path: "/keys-in-hardware", tile: "#0000FF",
  snip: "A secure enclave is a small, sealed part of the processor. Keys are created inside it and never read out.", kw: "enclave keys hardware security chip secure",
  points: ["Enclave keys are created inside the chip and can't be read out", "Signed actions prove they came from your device", "The phone becomes the root of trust, not a server"] };
BR_PAGES[BR_BOOK] = { kind: "book", title: "Nopa · Book a table", host: "tables.example", path: "/nopa", tile: "#17352A",
  snip: "Californian, wood-fired. 560 Divisadero St. Tables tonight from 6:00.", kw: "nopa restaurant dinner table book reservation food eat tonight",
  points: ["Nopa, 560 Divisadero St, Californian and wood-fired", "Tables tonight from 6:00 to 8:30", "Bookings are held for 15 minutes"] };

export const BR_ME = { name: "Alex Kim", phone: "(415) 555-0100" };

export const PH_SEED = (function () {
  var now = new Date(); var dow = now.getDay(); var sat = (dow + 1) % 7 || 7;
  function at(ago, h, m) { var d = new Date(now); d.setDate(d.getDate() - ago); d.setHours(h, m || 0, 0, 0); return d.getTime(); }
  var mid = new Date(now); mid.setHours(0, 1, 0, 0);
  function rel(min) { return Math.max(mid.getTime(), now.getTime() - min * 60000); }
  var R = [
    ["p01", rel(50), "shot", null, "", [], { kind: "shot", tags: ["boarding pass", "flight"] }],
    ["p02", rel(190), "cafe", null, "Tartine", [], {}],
    ["p03", at(1, 14, 20), "whiteboard", null, "Lumen HQ", ["maya", "sam"], {}],
    ["p04", at(1, 19, 5), "city", null, "Embarcadero", [], { tags: ["sunset"] }],
    ["p05", at(sat, 15, 10), "beach", [[42, 1]], "Ocean Beach", ["maya"], { fav: true }],
    ["p06", at(sat, 15, 14), "beach", null, "Ocean Beach", [], {}],
    ["p07", at(sat, 15, 40), "beach", [[36, 1], [63, 1.05, "#33303F"]], "Ocean Beach", ["maya", "priya"], {}],
    ["p08", at(sat, 16, 2), "portrait", [[50, 2]], "Ocean Beach", ["maya"], { fav: true, tone: 0 }],
    ["p09", at(sat, 16, 30), "sea", null, "Ocean Beach", [], { kind: "video", dur: "0:12" }],
    ["p10", at(sat, 18, 58), "sunsea", null, "Ocean Beach", [], { fav: true }],
    ["p11", at(sat, 19, 4), "sunsea", [[40, 0.9], [58, 0.95]], "Ocean Beach", ["maya", "priya"], {}],
    ["p12", at(sat, 20, 30), "food", null, "Nopa", ["maya", "priya"], {}],
    ["p13", at(sat + 1, 21, 40), "night", [[50, 1.3]], "SoMa", ["jordan"], {}],
    ["p14", at(sat + 1, 21, 55), "city", null, "SoMa", [], {}],
    ["p15", at(sat + 6, 9, 30), "mountain", null, "Mt Tamalpais", [], {}],
    ["p16", at(sat + 6, 10, 5), "forest", null, "Mt Tamalpais", [], {}],
    ["p17", at(sat + 6, 11, 20), "mountain", [[38, 1], [61, 0.95, "#1F2A24"]], "Mt Tamalpais", ["sam", "lena"], {}],
    ["p18", at(sat + 6, 11, 40), "portrait", [[50, 2]], "Mt Tamalpais", ["sam"], { tone: 1 }],
    ["p19", at(sat + 6, 12, 10), "mountain", null, "Mt Tamalpais", [], { kind: "video", dur: "0:24" }],
    ["p20", at(16, 19, 30), "birthday", [[30, 1.3]], "Portland", ["dad"], { fav: true }],
    ["p21", at(16, 19, 40), "portrait", [[50, 2]], "Portland", ["dad"], { tone: 3 }],
    ["p22", at(16, 20, 10), "food", null, "Portland", [], { tags: ["birthday"] }],
    ["p23", at(16, 21, 0), "doc", null, "Portland", [], { kind: "doc", tags: ["receipt"] }],
    ["p24", at(18, 8, 10), "lake", null, "Lake Tahoe", [], {}],
    ["p25", at(18, 13, 0), "lake", [[50, 1.1]], "Lake Tahoe", ["priya"], {}],
    ["p26", at(18, 13, 20), "lake", null, "Lake Tahoe", [], { kind: "video", dur: "0:08" }],
    ["p27", at(18, 18, 45), "sunset", null, "Lake Tahoe", [], {}],
    ["p28", at(25, 12, 0), "shot2", null, "", [], { kind: "shot", tags: ["directions"] }],
    ["p29", at(25, 16, 0), "park", [[46, 1]], "Dolores Park", ["lena"], {}],
    ["p30", at(25, 17, 10), "cafe", null, "Four Barrel", [], {}],
    ["p31", at(40, 14, 0), "beach", null, "Santa Cruz", [], {}],
    ["p32", at(40, 19, 10), "sunset", null, "Santa Cruz", [], {}]
  ];
  return R.map(function (r) {
    var x = r[6];
    return { id: r[0], ts: r[1], scene: r[2], figs: r[3], place: r[4], people: r[5], kind: x.kind || "photo", dur: x.dur || "", fav: !!x.fav, tone: x.tone || 0, tags: x.tags || [] };
  }).sort(function (a, b) { return b.ts - a.ts; });
})();


/* Scripted descriptions of the synthetic photo scenes. */
export const PH_DESC = {
  beach: "Ocean Beach in the afternoon: low tide, a long line of surf and a pale sky.",
  sea: "A short clip of waves rolling in, shot from the sand.",
  sunset: "A sunset, the sun halfway under the horizon.",
  sunsea: "Sunset over the water, with a warm streak of light on the waves.",
  mountain: "A mountain ridge with a snow-dusted peak behind it.",
  lake: "A still lake with mountains behind it and light on the water.",
  forest: "Tall pines on the trail.",
  park: "A park on a clear afternoon: lawn, two trees and a path up the hill.",
  city: "The skyline at dusk, lights coming on.",
  night: "A rooftop at night with the city lit up behind.",
  cafe: "A coffee on the table by a sunny window.",
  food: "Dinner from above: a tomato dish with greens, and a coffee on the side.",
  whiteboard: "A whiteboard from a working session: three bullet lines, a circled idea and some sticky notes.",
  shot: "A screenshot of a boarding pass.",
  shot2: "A screenshot of walking directions on a map.",
  doc: "A receipt. The total is at the bottom.",
  poster: "A scanned poster for Open Studio at Lumen, with a QR code.",
  portrait: "A portrait against a soft backdrop.",
  selfie: "A selfie in window light.",
  birthday: "A birthday cake with one candle, in a warm, dim room."
};
export const PH_SHARE = ["maya", "priya", "dad", "jordan", "sam", "lena"];

export const MAPS_PLACES = [
  { id: "tartine", name: "Tartine", cat: "Bakery", area: "Guerrero St", addr: "600 Guerrero St", x: 320, y: 1216, icon: "mapsFood", mi: 1.9, min: [11, 22, 38, 13], open: [7.5, 17], phone: "(415) 555-0172", web: "tartinebakery.com", pid: "priya", tags: "lunch bakery food bread cafe priya tartine",
    pts: [[608, 832], [384, 832], [384, 1216], [320, 1216]] },
  { id: "gym", name: "Equinox SoMa", cat: "Gym", area: "4th St", addr: "4th St & Howard St", x: 640, y: 704, icon: "mapsGym", mi: 0.4, min: [3, 6, 8, 3], open: [5, 22], phone: "(415) 555-0126", web: "equinox.com", tags: "gym workout fitness equinox",
    pts: [[608, 832], [640, 832], [640, 704]] },
  { id: "lumen", name: "Lumen studio", cat: "Office", area: "2nd St", addr: "2nd St & Mission St", x: 768, y: 640, icon: "mapsWork", mi: 0.6, min: [4, 9, 12, 5], open: [9, 19], pid: "maya", phone: "(415) 555-0190", web: "lumen.example", tags: "work office studio lumen maya",
    pts: [[608, 832], [768, 832], [768, 640]] },
  { id: "home", name: "Home", cat: "Home", area: "Liberty St", addr: "Liberty St, Dolores Heights", x: 224, y: 1344, icon: "mapsHome", mi: 2.4, min: [13, 26, 48, 16], open: "none", tags: "home house",
    pts: [[608, 832], [384, 832], [384, 1344], [224, 1344]] },
  { id: "sightglass", name: "Sightglass Coffee", cat: "Coffee", area: "7th St", addr: "270 7th St", x: 512, y: 896, icon: "mapsCup", mi: 0.3, min: [3, 5, 6, 2], open: [7, 18], phone: "(415) 555-0181", web: "sightglasscoffee.com", tags: "coffee cafe espresso",
    pts: [[608, 832], [576, 832], [576, 896], [512, 896]] },
  { id: "bluebottle", name: "Blue Bottle Coffee", cat: "Coffee", area: "Mint Plaza", addr: "66 Mint St", x: 576, y: 704, icon: "mapsCup", mi: 0.4, min: [3, 6, 8, 3], open: [7, 17], phone: "(415) 555-0115", web: "bluebottlecoffee.com", tags: "coffee cafe espresso",
    pts: [[608, 832], [576, 832], [576, 704]] },
  { id: "philz", name: "Philz Coffee", cat: "Coffee", area: "3rd St", addr: "3rd St & Harrison St", x: 704, y: 896, icon: "mapsCup", mi: 0.2, min: [2, 5, 5, 2], open: [6, 20], phone: "(415) 555-0163", web: "philzcoffee.com", tags: "coffee cafe espresso",
    pts: [[608, 832], [704, 832], [704, 896]] },
  { id: "sfo", name: "SFO", cat: "Airport", area: "San Francisco International", addr: "San Francisco International Airport", x: 780, y: 3040, icon: "plane", mi: 13.4, min: [22, 41, 270, 80], open: null, phone: "(650) 555-0100", web: "flysfo.com", tags: "airport sfo flight plane",
    pts: [[608, 832], [640, 832], [640, 960], [680, 1100], [640, 1500], [560, 1900], [620, 2400], [760, 2850], [780, 3040]] }
];

export const MAPS_FAR = [
  [/mountain view|palo alto/, 36, [48, 95, 720, 190], [[608, 832], [640, 832], [640, 960], [680, 1100], [640, 1500], [560, 1900], [620, 2400], [760, 2850], [700, 3190]]],
  [/new york|brooklyn|\bny\b/, 2900, null, [[608, 832], [1190, 700]]],
  [/portland|seattle/, 635, null, [[608, 832], [560, 10]]],
  [/oakland|berkeley/, 11, [22, 35, 220, 60], [[608, 832], [640, 832], [640, 400], [1190, 380]]]
];
/* Spoken place names, in priority order, for the synthetic map. */
export const MAPS_MATCH = [
  [/tartine|priya|lunch/, "tartine"],
  [/\bgym\b|equinox|workout/, "gym"],
  [/lumen|maya'?s (office|studio|work)|\bstudio\b|\bwork\b|\boffice\b/, "lumen"],
  [/\bhome\b/, "home"],
  [/\bsfo\b|airport/, "sfo"],
  [/sightglass/, "sightglass"],
  [/blue bottle/, "bluebottle"],
  [/philz/, "philz"]
];
/* Saved places: home and work are always pinned; ETA shares default to Maya. */
export const MAPS_SAVED = { home: "home", work: "lumen", workLabel: "Work", workName: "Work · Lumen studio", initial: ["tartine"], preset: "tartine", sharePerson: "maya", shareDest: { priya: "tartine" } };

export const NOTES_SEED = [
  { id: "sync", kind: "voice", title: "Design sync", when: "Yesterday · 4:10 PM", dur: 408, pinned: false,
    lines: [
      { s: "maya", t: "Okay, lock screen first. Notifications stay as icons until you unlock.", at: 0 },
      { s: "me", t: "Agreed. Voice still works locked, but the answers stay vague.", at: 42 },
      { s: "sam", t: "What about the chat over other apps?", at: 90 },
      { s: "maya", t: "Four heights. Pill, input, half, full. You drag between them.", at: 125 },
      { s: "me", t: "Let's cut the mark button from the recorder. Nobody used it.", at: 190 },
      { s: "sam", t: "I'll wire the new recorder into Notes by Thursday.", at: 242 },
      { s: "maya", t: "I'll send the prototype to the team tonight.", at: 315 },
      { s: "me", t: "And I'll book a review with Jordan for next week.", at: 390 }
    ],
    summary: ["Notifications stay as icons until unlock", "Voice works while locked; answers stay vague", "Chat has four heights: pill, input, half, full", "The recorder drops the mark button"],
    actions: [{ t: "Sam · wire the recorder into Notes by Thursday", done: false }, { t: "Maya · send the prototype to the team tonight", done: true }, { t: "Book a review with Jordan next week", done: false }] },
  { id: "enclave", kind: "text", title: "Enclave launch", body: "Confirm attestation flow\nShip the keys-on-device doc\nDry run Friday", pinned: true, when: "Today" },
  { id: "groceries", kind: "list", title: "Groceries", items: [{ t: "Oat milk", done: true }, { t: "Espresso beans", done: false }, { t: "Lemons", done: false }, { t: "Sourdough from Tartine", done: false }], pinned: false, when: "Today" },
  { id: "agents", kind: "link", title: "The case for on-device agents", url: "news.example/on-device-agents", domain: "news.example", when: "Mon",
    clips: ["Keys that never leave the device change what an assistant can be trusted with.", "Latency drops below the threshold where talking feels like thinking.", "The phone becomes the agent's body, not just its screen."] },
  { id: "gifts", kind: "text", title: "Gift ideas · Priya", body: "Film camera, ceramics class.\nShe mentioned the print show at SFMOMA.", pinned: false, when: "Sun" },
  { id: "landlord", kind: "text", title: "Radiator", body: "Call the landlord Friday. Bedroom radiator clanks all night.", pinned: false, when: "Sep 22" }
];


const CT_EXTRA = {
  maya: { address: "1450 Valencia St, San Francisco", birthday: "Mar 14" },
  jordan: { address: "88 Greenwich St, New York", birthday: "Nov 2" },
  priya: { address: "212 Castro St, Mountain View", birthday: "Jul 9" },
  sam: { address: "", birthday: "Jan 27" },
  lena: { address: "31 Bedford Ave, Brooklyn", birthday: "" },
  dad: { address: "2210 NE Alberta St, Portland", birthday: "Oct 11" }
};
const CT_MORE = [
  { id: "ana", first: "Ana", last: "Torres", phone: "(415) 555-0171", email: "ana@torres.example", address: "", birthday: "May 3", note: "Climbing partner", fav: false },
  { id: "ben", first: "Ben", last: "Adler", phone: "(415) 555-0163", email: "ben@adler.example", address: "", birthday: "", note: "Accountant", fav: false },
  { id: "kenji", first: "Kenji", last: "Sato", phone: "(206) 555-0148", email: "kenji@sato.example", address: "", birthday: "Dec 5", note: "", fav: false },
  { id: "olivia", first: "Olivia", last: "Brooks", phone: "(415) 555-0126", email: "olivia@brooks.example", address: "77 Dolores St, San Francisco", birthday: "", note: "Landlord", fav: false }
];

function ctIni(first, last) { var s = ((first || "").charAt(0) + (last || "").charAt(0)).toUpperCase(); return s || "#"; }
function ctMake(p) { var name = ((p.first || "") + " " + (p.last || "")).trim(); return Object.assign({}, p, { name: name || p.phone || "No name", ini: ctIni(p.first, p.last) }); }
export const CT_SEED = PEOPLE.map(function (p) {
  var parts = p.name.split(" ");
  return Object.assign({}, p, { first: parts[0], last: parts.slice(1).join(" "), address: "", birthday: "" }, CT_EXTRA[p.id] || {});
}).concat(CT_MORE.map(ctMake));

/* Folders beyond the generic Downloads, Documents, Receipts and Recordings. */
export const FILES_FOLDERS_EXTRA = [{ id: "Northpoint", icon: "folder", parent: "Documents" }];
export const FILES_SEED = [
  { id: "tartine", name: "Tartine receipt.jpg", type: "image", folder: "Receipts", size: "1.8 MB", when: "Today", scan: "receipt",
    receipt: { shop: "TARTINE", rows: [["Morning bun", "5.25"], ["Country loaf", "14.00"], ["Cappuccino x2", "11.50"], ["Tip", "7.75"]], total: "38.50" },
    sum: ["Tartine Bakery, today at 1:48 PM", "Total $38.50, paid with the Visa ending 4417", "Filed under Meals for the September report"] },
  { id: "termsheet", name: "Northpoint_TermSheet_v3.pdf", type: "pdf", folder: "Downloads", size: "212 KB", when: "Today", from: "jordan",
    heading: "Summary of Terms", rows: [["Issuer", "Alpha Compute, Inc."], ["Security", "Series A Preferred"], ["Amount", "$8,000,000"], ["Pre-money", "$32,000,000"], ["Liquidation", "1x, non-participating"], ["Board", "2 common · 1 investor · 1 independent"], ["No-shop", "30 days"]], pages: 4,
    sum: ["$8M Series A at a $32M pre-money, led by Northpoint", "1x non-participating liquidation preference", "Board of four: two common, one investor, one independent", "30-day no-shop; changed from v2: option pool now 12%"] },
  { id: "designnotes", name: "Design review notes.pdf", type: "pdf", folder: "Documents", size: "1.1 MB", when: "Today",
    heading: "Design review", rows: [["Date", "Today, 3:00 PM"], ["With", "Maya, Jordan, Sam, Lena"], ["Scope", "Lock screen, chat, Notes"]], pages: 2,
    sum: ["Review of lock screen, chat heights and the new Notes recorder", "Open question: how vague should locked voice answers be", "Maya to bring the prototype"] },
  { id: "memo", name: "Voice memo · landlord.m4a", type: "audio", folder: "Recordings", size: "2.4 MB", when: "Yesterday", dur: 72,
    sum: ["Reminder to call the landlord on Friday", "Bedroom radiator clanks at night", "Ask about the lease renewal date"] },
  { id: "equinox", name: "Equinox · September.pdf", type: "pdf", folder: "Receipts", size: "96 KB", when: "Sep 26",
    heading: "Equinox SoMa", rows: [["Membership", "September"], ["Amount", "$215.00"], ["Card", "Visa · 4417"]], pages: 1,
    sum: ["Equinox SoMa membership for September", "$215.00 charged to the Visa ending 4417", "Renews October 26"] },
  { id: "proto", name: "Prototype v7.zip", type: "archive", folder: "Downloads", size: "48 MB", when: "Sep 25",
    contents: ["Main.dc.html", "shell.js", "modules/", "assets/", "README.md"],
    sum: ["Prototype build 7 from Maya", "5 items, mostly the shell and app modules", "Newer than the build on your home screen"] },
  { id: "roadmap", name: "Q4 roadmap.docx", type: "doc", folder: "Documents", size: "220 KB", when: "Sep 24",
    heading: "Q4 roadmap", rows: [["October", "Notes, Files, Wallet"], ["November", "Workflows beta"], ["December", "Enclave launch"]], pages: 3,
    sum: ["Three launches: apps in October, Workflows in November, Enclave in December", "Hiring two on-device ML engineers", "Risk: model size on older phones"] },
  { id: "boarding", name: "Boarding pass SFO–JFK.pdf", type: "pdf", folder: "Downloads", size: "180 KB", when: "Sep 20",
    heading: "Boarding pass", rows: [["Flight", "UA 1542"], ["Date", "Oct 9 · 7:05 AM"], ["Seat", "14A"], ["Gate", "F12"]], pages: 1,
    sum: ["UA 1542, SFO to JFK, Oct 9 at 7:05 AM", "Seat 14A, gate F12, boarding 6:25", "Already in your calendar"] },
  { id: "deck", name: "Series A deck v12.pdf", type: "pdf", folder: "Northpoint", size: "6.2 MB", when: "Sep 18",
    heading: "Alpha Compute", rows: [["Slides", "18"], ["For", "Northpoint partners"]], pages: 18,
    sum: ["18 slides: problem, device, agent, traction, raise", "Ask: $8M Series A", "Traction slide still shows August numbers"] },
  { id: "sideletter", name: "Side letter draft.docx", type: "doc", folder: "Northpoint", size: "64 KB", when: "Sep 17",
    heading: "Side letter", rows: [["Parties", "Northpoint, Alpha Compute"], ["Status", "Draft"]], pages: 2,
    sum: ["Information rights for Northpoint", "Pro-rata in the next round", "Still a draft; not signed"] },
  { id: "img2041", name: "IMG_2041.jpg", type: "image", folder: "Downloads", size: "3.1 MB", when: "Sep 14", scan: "photo",
    sum: ["Photo of Ocean Beach at sunset", "Taken Sep 14 at 7:12 PM", "Also in Photos"] }
];

export const WAL_CARDS = [
  { id: "stone", name: "Household", last4: "0359", kind: "Debit", bg: "#D9D7D0", fg: "#000000", def: false, locked: false, tx: [
    { id: "s1", m: "Rainbow Grocery", a: 92.40, d: 6, icon: "walBag" },
    { id: "s2", m: "Cole Hardware", a: 23.10, d: 12, icon: "walBag" }] },
  { id: "work", name: "Work", last4: "7703", kind: "Credit", bg: "#1F1F1F", fg: "#FFFFFF", def: false, locked: false, tx: [
    { id: "w1", m: "GPU Reserve", a: 120.00, d: 1, icon: "chip", note: "Compute credits" },
    { id: "w2", m: "Philz Coffee", a: 7.25, d: 2, icon: "walCup" },
    { id: "w3", m: "Flight SFO to JFK", a: 389.00, d: 4, icon: "plane" },
    { id: "w4", m: "GPU Reserve", a: 480.00, d: 6, icon: "chip", note: "Compute credits" },
    { id: "w5", m: "GPU Reserve", a: 120.00, d: 13, icon: "chip", note: "Compute credits" }] },
  { id: "blue", name: "Alpha Blue", last4: "4821", kind: "Debit", bg: "#0000FF", fg: "#FFFFFF", def: true, locked: false, tx: [
    { id: "b1", m: "Tartine", a: 38.50, d: 0, icon: "walFood" },
    { id: "b2", m: "Sightglass Coffee", a: 6.50, d: 1, icon: "walCup" },
    { id: "b3", m: "Equinox SoMa", a: 210.00, d: 2, icon: "walGym", note: "Monthly membership" },
    { id: "b4", m: "Rainbow Grocery", a: 64.18, d: 3, icon: "walBag" },
    { id: "b5", m: "Transit reload", a: 20.00, d: 5, icon: "walBus" },
    { id: "b6", m: "Blue Bottle Coffee", a: 5.75, d: 8, icon: "walCup" },
    { id: "b7", m: "Tartine", a: 24.00, d: 11, icon: "walFood" }] }
];
export const WAL_TRIPS = [
  { id: "r1", m: "Bus · 4th St & Folsom St", a: 2.50, d: 0 },
  { id: "r2", m: "Train · Civic Center", a: 2.50, d: 1 },
  { id: "r3", m: "Bus · 16th St & Valencia St", a: 2.50, d: 3 }
];
export const WAL_MERCH = [["Sightglass Coffee", 6.50, "walCup"], ["Blue Bottle Coffee", 5.75, "walCup"], ["Philz Coffee", 7.25, "walCup"]];
/* Boarding pass and event ticket shown in Wallet, with their calendar entries. */
export const WAL_PASSES = [
  { id: "bp", title: "SFO → JFK", day: 3, time: "8:05 AM", icon: "plane", accent: true, qr: "SFOJFK1482-14A", place: "sfo",
    cal: { title: "Flight SFO → JFK", off: 3, t: 8 + 5 / 60, d: 5.6, where: "SFO · Gate B12 · Seat 14A", cal: "personal" },
    suggestions: ["When should I leave for SFO?", "Directions to SFO"],
    reply: { text: "Gate B12, seat 14A. Boarding at 7:25 AM", title: "SFO to JFK", sub: " · 8:05 AM · Gate B12" } },
  { id: "ticket", title: "Night Signals", day: 4, time: "8:00 PM", icon: "walTicket", qr: "NIGHTSIGNALS-GA-0412",
    cal: { title: "Night Signals", off: 4, t: 20, d: 3, where: "The Warfield, 982 Market St", cal: "personal" } }
];

export const WF_SEED = [
  { id: 1, name: "Morning brief", on: true,
    short: "Spoken rundown of your day, weekdays at 7",
    summary: "Weekdays at 7, a spoken rundown of your inbox and day the first time you pick up the phone.",
    trig: { kind: "time", days: "Weekdays", t: 7 },
    steps: [{ k: "Read", t: "Overnight inbox and today's calendar", apps: ["Mail", "Calendar"] }, { k: "Write", t: "A brief under a minute long", apps: [] }, { k: "Speak", t: "Speak it when I pick up the phone", apps: ["Speaker"] }],
    runs: [
      { id: "r11", when: "Today, 7:02 AM", status: "ok", sum: "Spoke a 48-second brief", dur: "2 min",
        log: [["When", "Started at 7:00 AM, a weekday.", "ok"], ["Read", "14 new emails and 6 events today.", "ok"], ["Write", "Picked the three things that need you: Jordan's term sheet, Maya's prototype, the 3:00 design review.", "ok"], ["Speak", "You picked up the phone at 7:02. Spoke it in 48 seconds.", "ok"]],
        out: "Morning. Three things today: Jordan sent a revised term sheet, Maya's bringing the prototype to the 3:00 design review, and you've got lunch with Priya at 1." },
      { id: "r12", when: "Yesterday, 7:00 AM", status: "ok", sum: "Spoke a 41-second brief", dur: "1 min",
        log: [["When", "Started at 7:00 AM, a weekday.", "ok"], ["Read", "9 new emails and 4 events.", "ok"], ["Write", "Two things need you: roadmap review at 2, coffee with Lena at 8:30.", "ok"], ["Speak", "Spoke it at 7:00 while you were already on the phone.", "ok"]],
        out: "Morning. Coffee with Lena at 8:30 and the roadmap review at 2. Nothing urgent overnight." },
      { id: "r13", when: "Fri, 7:00 AM", status: "skip", sum: "You'd already read your inbox", dur: "",
        log: [["When", "Started at 7:00 AM, a weekday.", "ok"], ["Read", "You'd opened Mail at 6:41 and read everything.", "ok"], ["Write", "Nothing new to say, so I didn't write a brief.", "skip"], ["Speak", "Skipped.", "skip"]], out: "" },
      { id: "r14", when: "Thu, 7:00 AM", status: "fail", sum: "Calendar access was revoked", dur: "",
        log: [["When", "Started at 7:00 AM, a weekday.", "ok"], ["Read", "Calendar access was revoked.", "fail"], ["Write", "No brief was created from incomplete sources.", "skip"], ["Speak", "Nothing was spoken.", "skip"]],
        out: "", fix: "Reconnect your calendar account, then review the sources before running again." }
    ] },
  { id: 2, name: "Protect focus", on: true,
    short: "Only Maya gets through during deep work",
    summary: "During deep work, everything but Maya waits, and you get what you missed when it ends.",
    trig: { kind: "event", ev: "A deep-work event starts" },
    steps: [{ k: "Do", t: "Turn on Do Not Disturb", apps: ["Settings"] }, { k: "If", t: "A message is from Maya, let it through", apps: ["Messages", "Contacts"] }, { k: "Write", t: "A summary of what I missed", apps: [] }, { k: "Notify", t: "A notification when the block ends", apps: [] }],
    runs: [
      { id: "r21", when: "Today, 11:00 AM", status: "ok", sum: "Held 5 notifications, let Maya through once", dur: "1 h 30 min",
        log: [["When", "Deep work started at 11:00 AM.", "ok"], ["Do", "Turned on Do Not Disturb.", "ok"], ["If", "Maya texted at 11:42. Let it through. Held 4 others.", "ok"], ["Write", "Summarized 5 held notifications.", "ok"], ["Notify", "Sent the summary at 12:30 PM.", "ok"]],
        out: "While you were focused: Jordan emailed the term sheet, Priya confirmed lunch, 3 newsletters." },
      { id: "r22", when: "Yesterday", status: "skip", sum: "No deep-work block", dur: "",
        log: [["When", "No deep-work event on your calendar yesterday.", "skip"]], out: "" }
    ] },
  { id: 3, name: "Receipts to Files", on: true,
    short: "Saves receipts from Mail and logs the amount",
    summary: "Receipts from Mail go to Files › Receipts, and the amount goes to Wallet.",
    trig: { kind: "email", match: "receipt" },
    steps: [{ k: "Do", t: "Save the attachment to Files", apps: ["Files"] }, { k: "Do", t: "Add the amount to Wallet", apps: ["Wallet"] }],
    runs: [
      { id: "r31", when: "Today, 9:14 AM", status: "fail", sum: "PDF was password-protected", dur: "",
        log: [["When", "An email from Delta matched “receipt”.", "ok"], ["Do", "Couldn't open the PDF. It's password-protected.", "fail"], ["Do", "Didn't add an amount, since there was nothing to read.", "skip"]],
        out: "", fix: "Ask me to open it with your Delta password, or forward the receipt without a password." },
      { id: "r32", when: "Yesterday, 6:05 PM", status: "ok", sum: "Saved Blue Bottle receipt · $6.50", dur: "4 s",
        log: [["When", "An email from Blue Bottle matched “receipt”.", "ok"], ["Do", "Saved receipt-0928.pdf to Files › Receipts.", "ok"], ["Do", "Added $6.50 to Wallet under Food.", "ok"]], out: "" }
    ] },
  { id: 4, name: "Weekly review", on: false,
    short: "One-page recap of your week, Fridays at 5",
    summary: "Fridays at 5, a one-page recap of your week's calendar, notes and sent mail, saved to Notes.",
    trig: { kind: "time", days: "Fridays", t: 17 },
    steps: [{ k: "Read", t: "This week's calendar, notes and sent mail", apps: ["Calendar", "Notes", "Mail"] }, { k: "Write", t: "A note in Notes", apps: ["Notes"] }],
    runs: [
      { id: "r41", when: "Sep 18, 5:00 PM", status: "ok", sum: "Wrote “Week of Sep 14” in Notes", dur: "40 s",
        log: [["When", "Friday, 5:00 PM.", "ok"], ["Read", "22 events, 6 notes, 31 sent emails.", "ok"], ["Write", "Saved a one-page review to Notes.", "ok"]], out: "" }
    ] }
];

/* Signed-in accounts on the reference phone. */
export const ST_ACCOUNTS = [
  { id: "a1", provider: "google", label: "Personal", address: "you@gmail.example", mail: true, calendar: true, contacts: true, access: { mail: "act", calendar: "act", contacts: "read" } },
  { id: "a2", provider: "microsoft", label: "Work", address: "you@alpha.example", mail: true, calendar: true, contacts: false, access: { mail: "read", calendar: "act", contacts: "read" } }
];
export const ST_NETS = [
  { id: "home", name: "Alpha Home", lock: true, sig: "Strong" },
  { id: "studio", name: "Studio 5G", lock: true, sig: "Strong" },
  { id: "ritual", name: "Ritual Coffee", lock: false, sig: "Good" },
  { id: "n24", name: "Neighbors_2.4", lock: true, sig: "Weak" }
];
export const ST_BT = [
  { id: "buds", name: "Pixel Buds Pro 2", d: "stHeadph", on: true },
  { id: "car", name: "Car", d: "stCar", on: false },
  { id: "kb", name: "Keyboard K3", d: "kbd", on: false }
];

export const ST_PERM0 = {
  mic: { alpha: true, phone: true, camera: true, notes: true, messages: true },
  loc: { alpha: true, maps: true, camera: true, photos: true },
  camera: { camera: true, messages: true, browser: false },
  contacts: { alpha: true, phone: true, messages: true, inbox: true }
};
export const ST_MODELS = [
  { id: "vision", name: "Vision 2B", size: "1.6 GB", pct: -1 },
  { id: "speech", name: "Speech", size: "310 MB", pct: 100 },
  { id: "translate", name: "Translate", size: "900 MB", pct: -1 }
];
export const ST_LOG = [
  ["2:15", "Drafted a reply to Maya", "bubble"], ["1:12", "Filed Jordan's term sheet", "mail"], ["12:40", "Moved Gym to 7:30 PM", "cal"],
  ["9:02", "Summarized 14 emails", "inbox"], ["7:10", "Ran Morning brief", "flow"], ["6:00", "Redaction receipt saved", "shield"]
];
export const ST_DEVLOG = [
  ["14:15:02", "agent  reply ok 412ms  tokens 188"], ["14:15:01", "memory recall  k=6  hits 4"], ["14:04:11", "npu  load core-7b-q4  1.9s"],
  ["13:12:40", "action calendar.move  signed"], ["06:00:00", "redaction receipt  saved"]
];

/* Device facts shown by Settings on the reference phone (battery, network, runtime). */
export const ST_DEVICE = {
  battery: { pct: 82, left: "About 1 day 6 hr", spoken: "82%. About a day and six hours left.", usage: [["sun", "Screen", "31%"], ["chip", "On-device model", "9%"], ["bubble", "Messages", "6%"]] },
  mobile: { label: "5G", carrier: "Alpha Mobile · 5G", usage: "3.2 of 20 GB" },
  runtime: { running: "elizaOS 2.1 · running", uptime: "3 d 4 h", npu: "18%", memoryItems: "2,418 items", memorySize: "2,418 items · 38 MB" },
  model: { name: "Core 7B", sub: "On device · NPU · 4-bit" }
};
/* About page of the reference phone. */
export const ST_ABOUT = {
  summary: "elizaOS 2.1", hero: "Alpha Compute phone", sub: "Powered by elizaOS",
  rows: [["elizaOS", "2.1.0"], ["Android", "17 · AOSP"], ["Build", "AC1.260915"], ["Redaction", "4.2"], ["Model", "Core 7B"]]
};

/* Notification shade and lock-screen counts of the reference phone. */
export const NOTIF = [
  { id: "n1", icon: "bubble", who: "Maya Chen", text: "Still on for 3? I can bring the prototype.", time: "2:04", go: { view: "messages", patch: { thread: "maya" } } },
  { id: "n2", icon: "mail", who: "Jordan Park", text: "Revised term sheet attached", time: "1:12", go: { view: "inbox", patch: { open: 2 } } },
  { id: "n3", icon: "cal", who: "Design review", text: "3:00 PM", time: "2:15", go: { view: "calendar", patch: { open: "c4" } } },
  { id: "n4", icon: "shield", who: "Redaction receipt", text: "3 identifiers replaced before the morning brief.", time: "6:00", go: { view: "settings", patch: { page: "privacy" } } }
];
export const LOCK_SUM = [
  { view: "messages", icon: "bubble", label: "2 message notifications", count: 2, notif: "n1" },
  { view: "inbox", icon: "mail", label: "1 email notification", count: 1, notif: "n2" },
  { view: "calendar", icon: "cal", label: "1 calendar notification", count: 1, notif: "n3" }
];
/* Initial quick-settings state and the reference-only Enclave lock tile ([state key, icon, label]). */
export const QUICK_SETTINGS = { wifi: true, bt: true, dnd: false, mic: true, loc: true, plane: false, shield: true, torch: false };
export const QUICK_TILES = [["shield", "shield", "Enclave lock"]];
/* SMS heads-up banner (the shell keeps it deferred with Messages). */
export const HEADS = { pid: "maya", ini: "MC", who: "Maya Chen", text: "Still on for 3? I can bring the prototype.", confirmed: "Confirmed with Maya", reply: "Yes, see you at 3. Bring the prototype!" };
/* Scripted voice demo: the typed-out phrase, and the locked-screen answer. */
export const VOICE = { locked: "What's next today?", fallback: "What does my afternoon look like?", lockedAnswer: "Design review at 3. Unlock for details." };
/* Home and digest rows that need attention. */
export const ATTENTION_ROWS = [
  { ini: "MC", who: "Maya Chen", text: "Still on for 3? I can bring the prototype.", icon: "bubble", go: { view: "messages", patch: { thread: "maya" } } },
  { ini: "JP", who: "Jordan Park", text: "Revised term sheet attached.", icon: "mail", go: { view: "inbox", patch: { open: 2 } } },
  { ini: "PN", who: "Priya Nair", text: "Sent you the photos from Saturday", icon: "bubble", go: { view: "messages", patch: { thread: "priya" } } }
];
/* Home card values of the reference layout. */
export const HOME_DEFAULTS = {
  homeCalendarLabel: "Next: Design review at 3:00 PM", homeCalendarTime: "3:00 PM", homeCalendarTitle: "Design review",
  homeWorkflowLabel: "Morning brief delivered at 7:02 AM", homeWorkflowTitle: "Morning brief", homeWorkflowTime: "7:02 AM"
};

/* Per-view scripted copy: suggestions, voice phrases, presets for the dev jump
   bar, canned replies ({ re, text, nav }) and reference values. */
export const COPY = {
  shell: { homeCalendar: { open: "c4" }, homeWorkflow: { open: 1, run: "latest" } },
  phone: {
    presetPerson: "maya",
    suggestions: { voicemail: ["Summarize my voicemail", "Call Maya back", "Who called?"], keypad: ["Call Dad", "Call Dr. Patel's office"], recents: ["Who called?", "Check voicemail", "Call Maya"] },
    voicePhrase: "Call Maya",
    ringContext: "Probably about the 3:00 design review",
    screenSummary: "Maya's running ten minutes late for 3:00.",
    declineVoicemail: { gist: "she's running ten minutes late", text: "Hey, it's Maya. Running ten minutes late for three. See you soon!" }
  },
  messages: {
    presetThread: "maya",
    suggestions: ["Text Maya I'm running late", "What did Priya send?", "Any new texts?"],
    voicePhrase: "Text Maya I'm running five minutes late"
  },
  inbox: {
    presets: { mail: { open: 2 }, compose: { compose: { to: "jordan", subject: "Re: Revised term sheet", body: "" } } },
    suggestions: { open: ["Draft a reply", "Summarize this email", "Forward to Maya"], list: ["Summarize my inbox", "Reply to Jordan", "Archive the rest"] },
    replies: [{ re: /term sheet (e-?mail|mail)|jordan'?s (e-?mail|mail)/, text: "Jordan's revised term sheet.", nav: { view: "inbox", patch: { open: 2 } } }]
  },
  calendar: {
    calendarSubs: ["Google", "Lumen"],
    presets: { event: { open: "c4", openDay: 0 }, invite: { open: "c10", openDay: 3 }, add: { add: { title: "Flight to JFK", off: 4, t: 8, d: 5.5, where: "SFO Terminal 2", notes: "UA 1542 · Seat 14C", cal: "personal" } } },
    suggestions: { form: ["Lunch with Priya next Tuesday at 1", "Find me an hour to focus"], day: ["What does my afternoon look like?", "Find me an hour to focus", "Move gym to tomorrow", "Lunch with Priya next Tuesday at 1"] }
  },
  browser: {
    suggestions: { book: ["Book a table for 2 at 7:30", "Summarize this page"], newtab: ["Book a table for 2 at 7:30", "Go to enclave.example"], page: ["Summarize this page", "Save the key points to Notes", "Book a table for 2 at 7:30"] }
  },
  camera: {
    place: "Dolores Park",
    describeFront: "That's you, with soft window light from the left. Good light for a selfie.",
    describeBack: "A park on a clear afternoon: lawn, two trees and a path up the hill. Plenty of light, no flash needed.",
    scan: { place: "Lumen HQ", tags: ["open studio", "lumen"], title: "Open Studio · Lumen", added: "Added Open Studio to your calendar.", link: "lumen.example/open-studio", describe: "A poster: Open Studio at Lumen, {day} at 6 PM, 1 Market St. The QR code goes to the RSVP page." }
  },
  photos: {
    presets: { viewer: { open: "p05", from: null }, search: "maya beach" },
    suggestions: { open: ["What's in this photo?", "Send this to Maya", "Make it warmer"], library: ["Photos of Maya at the beach", "Show Saturday's photos", "Make an album of the hike"] },
    voicePhrase: "Find photos of Maya at the beach"
  },
  maps: {
    suggestions: { base: ["Directions to Tartine", "How long to the gym?", "Find coffee nearby"] },
    voicePhrase: "How long to the gym?",
    placeNotes: { gym: "Leave by 7:20 for your 7:30 session." },
    whereAmI: "Folsom St near 4th, in SoMa."
  },
  notes: {
    presets: { editor: "enclave", voice: "sync" },
    digest: { re: /design sync/, id: "sync", text: "Four decisions and three follow-ups." }
  },
  contacts: {
    presetDetail: "maya",
    presetEdit: "jordan",
    suggestions: ["What's Maya's number?", "Add a contact Alex Kim 415 555 0100", "When is Dad's birthday?"],
    voicePhrase: "What's Maya's number?"
  },
  files: {
    presetPreview: { folder: "Downloads", open: "termsheet" },
    suggestions: { open: ["Summarize this file", "Send this to Jordan"], receipts: ["Total my receipts this month", "Find the term sheet"], root: ["Find the term sheet", "Show my receipts", "What's taking up space?"] },
    voicePhrase: "Find the term sheet",
    findShortcut: { re: /term ?sheet/, id: "termsheet", from: ", from Jordan's email this afternoon." },
    receipts: { total: "$253.50", list: "Tartine $38.50 and Equinox $215.00" },
    summaryDefaults: { receipt: "tartine", pdf: "termsheet" },
    storage: { text: "38 GB used of 256. Biggest: Prototype v7.zip at 48 MB and 12 GB of video in Photos.", title: "218 GB free", sub: "Prototype v7.zip · 48 MB" },
    shareTo: { match: [[/jordan/, "jordan"], [/maya/, "maya"], [/priya/, "priya"]], fallback: "jordan" },
    photosSub: "2,184",
    storageW: "15%",
    storageText: "218 GB free"
  },
  wallet: {
    transit: 23.40,
    presets: { card: "blue", pass: "bp", addForm: { num: "4000 1234 5678 9017", exp: "11/29", name: "", cvv: "" } },
    suggestions: ["How much did I spend this week?", "Show my boarding pass", "Pay with my work card"],
    spendNotes: function (w, only, top, money) {
      var out = [];
      if (!only && w.by["Equinox SoMa"]) out.push("Equinox renewed at " + money(w.by["Equinox SoMa"]) + ", as usual");
      if (!only || only === "work") { var g = w.by["GPU Reserve"]; if (g && top !== "GPU Reserve") out.push("GPU Reserve: " + money(g)); }
      return out;
    }
  },
  workflows: {
    sendPresets: [["A message to Maya", ["Messages"]]],
    triggerPerson: "maya",
    presets: { flow: { open: 1 }, run: { open: 1, run: "latest" }, failed: { open: 1, run: "r14" } },
    suggestions: ["Why did Morning brief run?"]
  },
  settings: {
    conns: { slack: true, github: true },
    wifiCur: "home",
    wifiKnown: ["home", "studio"],
    wifiSuggestions: ["Connect to Ritual Coffee"]
  }
};
