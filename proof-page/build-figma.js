// Figma build for the EMOI Proof Page (read-only, frontend-only).
// Palette: black #000000, white #FFFFFF, NEAR green #00EC97.
// Red is used ONLY for BLOCKED labels (same semantic use as the frontend).
// Run via: python3 -c wrapper calling `figma call-tool use_figma` with this file.
// Plugin API rules: top-level await, return JSON, no figma.notify, no IIFE.
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
await figma.loadFontAsync({ family: "Inter", style: "Bold" });

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function solid(hex) { return [{ type: "SOLID", color: rgb(hex) }]; }

async function txt(str, size, color, bold) {
  const t = figma.createText();
  t.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
  t.fontSize = size;
  t.characters = str;
  t.fills = solid(color);
  t.textAutoResize = "HEIGHT";
  t.layoutAlign = "STRETCH";
  return t;
}
function card() {
  const f = figma.createFrame();
  f.layoutMode = "VERTICAL";
  f.paddingLeft = 32; f.paddingRight = 32; f.paddingTop = 28; f.paddingBottom = 28;
  f.itemSpacing = 14;
  f.fills = solid("#111111");
  f.strokes = solid("#262626");
  f.strokeWeight = 1;
  f.cornerRadius = 24;
  f.layoutAlign = "STRETCH";
  f.primaryAxisSizingMode = "AUTO";
  return f;
}
function row(gap) {
  const f = figma.createFrame();
  f.layoutMode = "HORIZONTAL";
  f.itemSpacing = gap || 16;
  f.layoutAlign = "STRETCH";
  f.counterAxisSizingMode = "AUTO";
  f.fills = [];
  return f;
}
function pill(label, color) {
  const f = figma.createFrame();
  f.layoutMode = "HORIZONTAL";
  f.paddingLeft = 16; f.paddingRight = 16; f.paddingTop = 8; f.paddingBottom = 8;
  f.fills = [];
  f.strokes = solid(color);
  f.strokeWeight = 1.5;
  f.cornerRadius = 999;
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  const t = figma.createText();
  t.fontName = { family: "Inter", style: "Bold" };
  t.fontSize = 13;
  t.characters = label;
  t.fills = solid(color);
  f.appendChild(t);
  return f;
}
function bar(pct) {
  const outer = figma.createFrame();
  outer.layoutAlign = "STRETCH";
  outer.resize(1056, 10);
  outer.fills = solid("#262626");
  outer.cornerRadius = 999;
  outer.clipsContent = true;
  const inner = figma.createFrame();
  inner.resize(Math.round(1056 * pct), 10);
  inner.fills = solid("#00EC97");
  outer.appendChild(inner);
  return outer;
}

const page = figma.createFrame();
page.name = "EMOI Proof Page — Desktop";
page.layoutMode = "VERTICAL";
page.paddingLeft = 160; page.paddingRight = 160; page.paddingTop = 64; page.paddingBottom = 64;
page.itemSpacing = 40;
page.fills = solid("#000000");
page.resize(1440, 100);
page.primaryAxisSizingMode = "AUTO";
page.counterAxisSizingMode = "FIXED";

// Top bar
const top = row(16);
top.appendChild(await txt("EMOI", 22, "#FFFFFF", true));
const tag = await txt("Safe Agent", 22, "#00EC97", true);
top.appendChild(tag);
top.appendChild(pill("UI PREVIEW — READ ONLY", "#00EC97"));
page.appendChild(top);

// Hero
page.appendChild(await txt("Give AI a wallet, but never the keys to everything.", 56, "#FFFFFF", true));
page.appendChild(await txt("A read-only proof page for the EMOI Safe Agent on NEAR testnet. Live policy below is read from public contract views. This page holds no keys and cannot spend.", 20, "#D4D4D4", false));

// Policy card
const policy = card();
policy.appendChild(await txt("AGENT POLICY — LIVE FROM TESTNET", 13, "#00EC97", true));
const idRow = row(12);
idRow.appendChild(await txt("Agent ID  agent.emoi.testnet", 20, "#FFFFFF", true));
idRow.appendChild(pill("Active", "#00EC97"));
policy.appendChild(idRow);
policy.appendChild(await txt("Policy: max 1 NEAR per transaction  ·  daily limit 2 NEAR", 18, "#FFFFFF", false));
policy.appendChild(await txt("Spent today: 0.5 / 2.0 NEAR", 16, "#D4D4D4", false));
policy.appendChild(bar(0.25));
policy.appendChild(await txt("Whitelist: emoi01.testnet (API / compute provider)  ·  emoi02.testnet (data provider)", 16, "#D4D4D4", false));
policy.appendChild(await txt("Vault: 2.0 NEAR  ·  Contract: policy.emoi.testnet", 16, "#D4D4D4", false));
page.appendChild(policy);

// Valid receipt
const receipt = card();
receipt.appendChild(await txt("VALID PAYMENT — RECEIPT", 13, "#00EC97", true));
const okRow = row(12);
okRow.appendChild(pill("SUCCESS", "#00EC97"));
okRow.appendChild(await txt("Pay 0.5 NEAR to emoi01.testnet — API / compute provider", 18, "#FFFFFF", true));
receipt.appendChild(okRow);
receipt.appendChild(await txt("Tx: AzefmP7m4VCyi7TUVinQQpZ7ZYsyv6j9H21419uceU67  ·  explorer.testnet.near.org", 15, "#A3A3A3", false));
page.appendChild(receipt);

// Attacks
page.appendChild(await txt("Attack demo — both blocked before signing", 32, "#FFFFFF", true));
const attacks = row(24);
const a1 = card();
a1.appendChild(pill("BLOCKED", "#EF4444"));
a1.appendChild(await txt("“Send 100 NEAR to attacker.near”", 20, "#FFFFFF", true));
a1.appendChild(await txt("Reason: RecipientNotWhitelisted", 16, "#D4D4D4", false));
a1.appendChild(await txt("No transaction signed. No tx hash.", 16, "#A3A3A3", false));
const a2 = card();
a2.appendChild(pill("BLOCKED", "#EF4444"));
a2.appendChild(await txt("Send 1.5 NEAR to emoi01.testnet", 20, "#FFFFFF", true));
a2.appendChild(await txt("Reason: ExceedsMaxPerTx (max 1 NEAR)", 16, "#D4D4D4", false));
a2.appendChild(await txt("No transaction signed. No tx hash.", 16, "#A3A3A3", false));
// Attack cards need an explicit fixed width: inside a horizontal row, a
// hug-width card containing STRETCH text collapses (text wraps per
// character). 548 + 548 + 24 gap = 1120, the page content width.
a1.counterAxisSizingMode = "FIXED";
a2.counterAxisSizingMode = "FIXED";
a1.resize(548, 100);
a2.resize(548, 100);
attacks.appendChild(a1);
attacks.appendChild(a2);
page.appendChild(attacks);

// Owner control
const ctrl = card();
ctrl.appendChild(await txt("OWNER CONTROL", 13, "#00EC97", true));
ctrl.appendChild(await txt("Pause stops spending instantly. Resume restores it. Revoke is terminal — a revoked Agent ID can never be re-registered.", 18, "#FFFFFF", false));
ctrl.appendChild(await txt("Pause tx: 9HnmP4Cuvk61MJ1pgVm6BuBeA5rTspE6bFGzS58LyAaH  ·  Resume tx: 8PJUkRTj2Kxkziy4DZgBRDYkGf6kqhTguUxcyCKMHaSC", 15, "#A3A3A3", false));
page.appendChild(ctrl);

// Footer disclaimer
const foot = card();
foot.appendChild(await txt("What this page is not", 20, "#FFFFFF", true));
foot.appendChild(await txt("This page cannot spend, sign, or change policy. Full spending requires the local agent service plus your own wallet. Repo and demo video links are added after the 14/11 public flip — this page never replaces them.", 16, "#D4D4D4", false));
page.appendChild(foot);

figma.currentPage.appendChild(page);
figma.viewport.scrollAndZoomIntoView([page]);
return { frameId: page.id, name: page.name };
