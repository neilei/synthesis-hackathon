# Sponsor Brand Reference

Official brand colors and usage notes for each sponsor integration.
Assets stored in `apps/dashboard/public/sponsors/`.

---

## Venice.ai

**Source:** [venice.ai/brand](https://venice.ai/brand) — official brand kit (Keys SVG)

| Color        | Hex       | Usage                    |
| ------------ | --------- | ------------------------ |
| White        | `#FFFFFF` | Logo on dark backgrounds |
| Venice Red   | `#DD3300` | Logo on light backgrounds|
| Black        | `#000000` | Logo on light backgrounds|

**Asset used:** `venice.svg` — Venice Keys (red `#DD3300` variant). Red chosen for brand recognition on dark backgrounds. Red text color (`#DD3300`) used for sponsor name alongside logo.

**Name:** Always "Venice.ai" (not "Venice"). The ".ai" is part of the brand name.

**Guidelines:** Follow the Venice Brand Guidelines PDF (available at venice.ai/brand). Use the Keys logomark at small sizes; use the full lockup (wordmark + keys) only where space allows.

---

## Uniswap

**Source:** [github.com/Uniswap/brand-assets](https://github.com/Uniswap/brand-assets) — official brand repo

| Color       | Hex       | Usage                          |
| ----------- | --------- | ------------------------------ |
| Uniswap Pink| `#FF007A` | Primary brand / text / UI      |
| Icon Pink   | `#F50DB4` | Unicorn icon fill              |
| Charm       | `#D973A3` | Secondary pink                 |
| Tuna        | `#33363D` | Dark neutral / background      |

**Asset used:** `uniswap.svg` — Unicorn icon (pink `#F50DB4`, from official repo)

**Guidelines:** See `Uniswap_Brand_Guidelines.pdf` in the brand assets repo. Maintain clear space. Do not alter colors, stretch, or add effects. Refer to [uniswap.org/trademark](https://uniswap.org/trademark) for trademark policy.

---

## MetaMask

**Source:** [metamask.io/assets](https://metamask.io/assets), [github.com/MetaMask/brand-resources](https://github.com/MetaMask/brand-resources)

| Color          | Hex       | Usage                    |
| -------------- | --------- | ------------------------ |
| Pumpkin Orange | `#F6851B` | Primary brand color      |
| Dark Orange    | `#E2761B` | Secondary / darker shade |
| Fox Orange     | `#FF5C16` | Fox icon fill (favicon)  |
| Fox Light      | `#FF8D5D` | Fox icon highlight       |
| Fox Dark       | `#661800` | Fox icon shadow/outline  |
| Fox Accent     | `#E7EBF6` | Fox icon eye/chin detail |

**Asset used:** `metamask.svg` — Fox favicon from metamask.io (multi-color fox head)

**Guidelines:** Download authentic logos only from metamask.io/assets or the GitHub brand-resources repo. Maintain minimum clear space around the fox (one polygon height). Never alter colors, stretch proportions, or add effects like shadows or outlines.

---

## Protocol Labs

**Source:** [protocol.ai](https://protocol.ai) press kit

| Color        | Hex       | Usage                    |
| ------------ | --------- | ------------------------ |
| Persian Blue | `#1541BE` | Primary brand blue       |
| Solitude     | `#DFEBFF` | Light background/accent  |
| White        | `#FFFFFF` | Logo on dark backgrounds |

**Asset used:** `protocol-labs.svg` — Symbol mark (white variant, for dark UI)

**Guidelines:** Protocol Labs press kit provides white, blue, and black variants. Use white on dark backgrounds. Use blue or black on light backgrounds.

---

## Dark UI Text Color Adjustments

On our `#09090b` zinc-950 background, some official brand colors lack WCAG AA contrast.
The SponsorChip component uses lightened variants for text only (logos keep original colors):

| Sponsor        | Official         | UI Text          | Contrast | Notes                               |
| -------------- | ---------------- | ---------------- | -------- | ----------------------------------- |
| Venice.ai      | `#DD3300` (4.3:1)| `#EE4400` (5.2:1)| AA pass  | Lightened for readability           |
| Uniswap        | `#FF007A` (5.2:1)| `#FF007A` (5.2:1)| AA pass  | Original works                      |
| MetaMask       | `#F6851B` (7.9:1)| `#F6851B` (7.9:1)| AA pass  | Original works                      |
| Protocol Labs  | `#1541BE` (2.4:1)| `#6B8FD4` (6.2:1)| AA pass  | Significantly lightened; original unusable on dark |

---

## Compliance Checklist

- [ ] All logos sourced from official brand kits (not recreated/traced)
- [ ] Logo colors match official assets (not recolored)
- [ ] "Venice.ai" always includes ".ai" suffix
- [ ] Dark UI uses white/light logo variants
- [ ] Minimum clear space maintained around each logo
- [ ] No effects (drop shadows, glows, outlines) added to logos
- [ ] Logos not stretched, skewed, or rotated
