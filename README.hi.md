# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**शानदार रेफ़रेंस डिज़ाइनों से शुरुआत करें, खाली AI कैनवास से नहीं।**

Design Lens एक plugin है **Claude Code**, **OpenAI Codex CLI**, **Cursor** और **OpenCode** के लिए,
जो रेफ़रेंस डिज़ाइनों (awwwards-स्तर की साइटों) से शुरुआत करके सौंदर्य की दृष्टि से उत्कृष्ट
फ़्रंटएंड बनाने में आपकी मदद करता है:

1. **Clone** — किसी रेफ़रेंस पेज को एक आत्मनिर्भर, सुव्यवस्थित रूप से फ़ॉर्मेट किए गए लोकल मिरर में
   कैप्चर करें: JS से रेंडर हुआ अंतिम DOM, CSS-in-JS/shadow-DOM स्टाइल सुरक्षित, हर एसेट लोकल,
   हर एलिमेंट पर एक स्थिर `data-dl-id` की मुहर।
2. **Reverse-design** — क्लोन को एक वरिष्ठ डिज़ाइनर की तरह पढ़ें और `DESIGN.md`
   (हर निर्णय क्यों लिया गया) + `VARIATIONS.md` (ऐसी नई दिशाएँ जो सिद्धांतों को बरकरार रखती हैं) तैयार करें।
3. **Customize** — बातचीत के ज़रिए logo बदलें, nav का टेक्स्ट फिर से लिखें, hero इमेज बदलें,
   रंग और आकार बदलें — agent सीधे क्लोन को संपादित करता है, `data-dl-id` के सहारे।

## इंस्टॉल

| Agent | अनुशंसित चैनल | रनटाइम प्रावधान |
| --- | --- | --- |
| Claude Code | plugin (नीचे) या `npx skills` | स्वचालित (SessionStart hook) |
| Codex CLI | plugin (नीचे) या `npx skills` | `/hooks` के ज़रिए hook पर भरोसा करें, या नीचे दिया फ़ॉलबैक |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | पहली बार उपयोग पर `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | पहली बार उपयोग पर `npx -y design-lens setup` |

### चैनल 1 — plugin (Claude Code / Codex)

Claude Code:

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

Codex CLI:

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

पहले सत्र में एक `SessionStart` hook `~/.design-lens/` (CLI, पिन किया हुआ Playwright, Chromium)
तैयार करता है। **Codex पर आपको पहले `/hooks` के ज़रिए plugin hook पर भरोसा करना होगा, या एक बार
हाथ से `bash <plugin-cache-dir>/scripts/bootstrap.sh` चलाना होगा** — देखें
[`plugin/README.md`](./plugin/README.md)।

### चैनल 2 — `npx skills` (skills-सक्षम कोई भी agent)

```bash
npx skills add mojomoth/design-lens          # इंस्टॉल किए गए agents को अपने आप पहचानता है
npx skills add mojomoth/design-lens -a cursor -a opencode   # या किसी खास agent को लक्षित करें
```

इस तरीके से इंस्टॉल किए गए agents के पास कोई provisioning hook नहीं होता; skills पहली बार उपयोग पर
`npx -y design-lens setup` चलाकर खुद को दुरुस्त कर लेती हैं (या इसे एक बार खुद चला लें)।

### चैनल 3 — npm के ज़रिए सादा CLI

```bash
npx design-lens setup                        # एक बार: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # या CLI को सीधे इस्तेमाल करें, बिना किसी plugin के
```

**LLM agents के लिए** — इसे अपने agent में पेस्ट करें:

> https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md का पालन करके design-lens इंस्टॉल करें

Dev लूप (बिना इंस्टॉल): `claude --plugin-dir ./plugin`। `marketplace add` के लिए
`mojomoth/design-lens` की जगह एक लोकल एब्सोल्यूट पाथ भी काम करता है।

Skills (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`।

> Clone फ़ीचर **निजी डिज़ाइन अध्ययन और व्युत्पत्ति** के लिए है। हर क्लोन के साथ एक लाइसेंस नोटिस और
> शिप-पूर्व ब्रांड चेकलिस्ट आती है: कुछ भी व्युत्पन्न शिप करने से पहले logo बदलें, कॉपी फिर से लिखें,
> फ़ोटोग्राफ़ी और फ़ॉन्ट का लाइसेंस लें या उन्हें बदलें। क्लोन को कभी डिप्लॉय या पुनर्वितरित नहीं
> करना है — देखें [Fair use और डिज़ाइनरों का सम्मान](./plugin/README.md#fair-use--respect-for-designers)।

## रिपॉज़िटरी संरचना

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## स्वायत्त विकास (harness)

यह plugin एक Ralph लूप द्वारा एक ही बार में बनाया गया है — हर iteration में ताज़ा agent संदर्भ,
सारी मेमोरी डिस्क पर, और एक सील्ड प्रोग्रामेटिक वेरिफ़िकेशन गेट। इसे चलाने के लिए:

```bash
./.harness/bootstrap.sh     # एक बार: git init, Chromium, fixture self-test, integrity seal
./.harness/ralph.sh plan    # planning लूप: 3-critic बहस → IMPLEMENTATION_PLAN.md
# अनुशंसित मानव जाँच-बिंदु: .agentdocs/IMPLEMENTATION_PLAN.md पर एक नज़र डालें
./.harness/ralph.sh build   # build लूप: हर iteration में एक task, जब तक strict गेट green न हो जाए
```

दूसरे टर्मिनल से निगरानी करें:

```bash
./.harness/ralph.sh status                     # मौजूदा task / iteration / लागत
tail -f .harness/logs/current/*.stderr         # लाइव agent आउटपुट
cat .harness/status/verify-feedback.md         # गेट ने अगले iteration को क्या ठीक करने को कहा
touch .harness/STOP                            # सहज रोक; फिर शुरू करें: ralph.sh resume
```

बजट और मॉडल `.harness/config.env` में समायोज्य हैं। लूप तभी समाप्त होता है जब agent का completion
दावा और स्वतंत्र सील्ड गेट (`.harness/verify.sh --strict`) — दोनों पास हों।

## लाइसेंस

MIT। bundled और runtime थर्ड-पार्टी dependencies [`plugin/NOTICE.md`](./plugin/NOTICE.md) में
सूचीबद्ध हैं। `clone` द्वारा कैप्चर की गई सामग्री उस लाइसेंस के दायरे में नहीं आती और अपने मालिकों
की संपत्ति बनी रहती है।
